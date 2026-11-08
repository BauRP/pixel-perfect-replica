package kz.soundworld.ar;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.app.ActivityManager;
import android.os.BatteryManager;
import android.os.PowerManager;
import com.google.mediapipe.tasks.audio.audioclassifier.AudioClassifier;
import com.google.mediapipe.tasks.audio.audioclassifier.AudioClassifier.AudioClassifierOptions;
import com.google.mediapipe.tasks.audio.audioclassifier.AudioClassifierResult;
import com.google.mediapipe.tasks.components.containers.AudioData;
import com.google.mediapipe.tasks.components.containers.AudioData.AudioDataFormat;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.components.containers.Classifications;
import com.google.mediapipe.tasks.components.containers.ClassificationResult;
import com.google.mediapipe.tasks.core.BaseOptions;
import java.io.IOException;

/**
 * Real on-device microphone routing/probe and Android step detector.
 * NO fake YAMNet output: inference stays unavailable until a verified local
 * TFLite model/runtime is added. No microphone use before an explicit action.
 * Not a background media service: the probe stops on pause/destroy.
 */
@CapacitorPlugin(
  name = "SoundWorldSensors",
  permissions = {
    @Permission(alias = "mic", strings = {Manifest.permission.RECORD_AUDIO}),
    @Permission(alias = "activity", strings = {Manifest.permission.ACTIVITY_RECOGNITION})
  }
)
public class SoundWorldSensorsPlugin extends Plugin implements SensorEventListener {
  private final Object captureLock = new Object();
  private final AtomicBoolean capturing = new AtomicBoolean(false);
  private AudioRecord recorder;
  private volatile AudioClassifier analyzer;
  private ExecutorService inferenceWorker;
  private final AtomicBoolean inferenceBusy = new AtomicBoolean(false);
  private volatile int skippedInferenceWindows = 0;
  private final long appStartedAt = SystemClock.elapsedRealtime();
  private volatile int actualInputType = -1;
  private Thread captureThread;
  private SensorManager sensorManager;
  private Sensor stepDetector;
  private boolean listeningSteps = false;
  private volatile String actualInput = "";
  private volatile String actualKind = "";
  private volatile String inputPreference = "auto";

  private boolean hasYamnetAsset() {
    try (java.io.InputStream in = getContext().getAssets().open("yamnet.tflite")) { return in.read() != -1; }
    catch (IOException e) { return false; }
  }

  private boolean granted(String permission) {
    return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
  }

  @PluginMethod
  public void status(PluginCall call) {
    JSObject o = new JSObject();
    o.put("yamnetIncluded", hasYamnetAsset()); // verified local asset presence, not successful inference
    o.put("microphoneGranted", granted(Manifest.permission.RECORD_AUDIO));
    o.put("activityGranted", granted(Manifest.permission.ACTIVITY_RECOGNITION));
    SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    o.put("stepsSupported", sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) != null);
    o.put("recording", capturing.get());
    o.put("actualInput", actualInput);
    o.put("skippedInferenceWindows", skippedInferenceWindows);
    call.resolve(o);
  }

  @PluginMethod
  public void requestMicrophone(PluginCall call) {
    if (granted(Manifest.permission.RECORD_AUDIO)) {
      JSObject result = new JSObject(); result.put("granted", true); call.resolve(result);
    } else requestPermissionForAlias("mic", call, "onMicPermission");
  }

  @PermissionCallback
  private void onMicPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", getPermissionState("mic") == PermissionState.GRANTED);
    call.resolve(result);
  }

  @PluginMethod
  public void setInputPreference(PluginCall call) {
    String requested = call.getString("preference", "auto");
    if (!"auto".equals(requested) && !"headset".equals(requested) && !"phone".equals(requested)) {
      call.reject("Неизвестный режим микрофона"); return;
    }
    inputPreference = requested;
    JSObject result = new JSObject(); result.put("selected", requested);
    call.resolve(result);
  }

  @PluginMethod
  public void requestActivity(PluginCall call) {
    if (granted(Manifest.permission.ACTIVITY_RECOGNITION)) {
      JSObject result = new JSObject(); result.put("granted", true); call.resolve(result);
    } else requestPermissionForAlias("activity", call, "onActivityPermission");
  }

  @PermissionCallback
  private void onActivityPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", getPermissionState("activity") == PermissionState.GRANTED);
    call.resolve(result);
  }

  @PluginMethod
  public void startAnalysis(PluginCall call) {
    if (!hasYamnetAsset()) { call.reject("Модель YAMNet отсутствует в APK"); return; }
    new Thread(() -> openCapture(call, true), "SoundWorld-Yamnet-Init").start();
  }

  @PluginMethod
  public void startMicrophoneProbe(PluginCall call) {
    new Thread(() -> openCapture(call, false), "SoundWorld-Mic-Init").start();
  }

  /** All I/O and model initialization happens off the Android UI thread. */
  private void openCapture(PluginCall call, boolean classify) {
    if (!granted(Manifest.permission.RECORD_AUDIO)) {
      call.reject("Требуется разрешение микрофона");
      return;
    }
    synchronized (captureLock) {
      if (capturing.get()) {
        JSObject r = new JSObject(); r.put("started", true); call.resolve(r); return;
      }
      int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (min <= 0) { call.reject("Устройство не поддерживает захват 16 кГц"); return; }
      AudioRecord rec = null;
      AudioClassifier preparedClassifier = null;
      try {
        if (classify) {
          AudioClassifierOptions options = AudioClassifierOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath("yamnet.tflite").build())
            .setMaxResults(5)
            .build();
          preparedClassifier = AudioClassifier.createFromOptions(getContext(), options);
        }
        rec = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
          Math.max(min * 2, 3200));
        if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Микрофон не инициализирован");
        AudioManager manager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (manager != null) {
          AudioDeviceInfo best = null;
          for (AudioDeviceInfo d : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (!d.isSource()) continue;
            int type = d.getType();
            boolean headset = type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_USB_HEADSET
              || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET;
            boolean phone = type == AudioDeviceInfo.TYPE_BUILTIN_MIC;
            if (("phone".equals(inputPreference) && phone)
              || (!"phone".equals(inputPreference) && headset)) {
              best = d;
              break;
            }
          }
          // Android may reject the preference; always report the actual routed device.
          if (best != null) rec.setPreferredDevice(best);
        }
        rec.startRecording();
        if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Захват микрофона не начался");
        recorder = rec;
        analyzer = preparedClassifier;
        if (preparedClassifier != null) inferenceWorker = Executors.newSingleThreadExecutor(r -> {
          Thread t = new Thread(r, "SoundWorld-Yamnet-Worker");t.setDaemon(true);return t;
        });
        AudioDeviceInfo routed = rec.getRoutedDevice();
        actualInput = routed != null ? String.valueOf(routed.getProductName()) : "Маршрут ещё не определён";
        actualKind = routed != null ? String.valueOf(routed.getType()) : "unknown";
        actualInputType = routed != null ? routed.getType() : -1;
        skippedInferenceWindows = 0;
        capturing.set(true);
        final AudioRecord active = rec;
        captureThread = new Thread(() -> readMic(active), "SoundWorld-Microphone-Probe");
        captureThread.setDaemon(true);
        captureThread.start();
        JSObject r = new JSObject(); r.put("started", true); call.resolve(r);
      } catch (Exception ex) {
        capturing.set(false);
        if (rec != null) { try { rec.release(); } catch (Exception ignored) {} }
        if (preparedClassifier != null) try { preparedClassifier.close(); } catch (Exception ignored) {}
        recorder = null; actualInput = ""; actualKind = "";
        call.reject("Не удалось открыть микрофон: " + ex.getMessage());
      }
    }
  }

  private void readMic(AudioRecord rec) {
    short[] samples = new short[1600];
    long lastReport = 0;
    // 15600 samples = 975 ms, the input window required by YAMNet.
    final float[] soundWindow = new float[15600];
    int soundFilled = 0;
    try {
      while (capturing.get()) {
        int n = rec.read(samples, 0, samples.length);
        if (n <= 0) {
          if (n < 0) sendError("Ошибка чтения микрофона: " + n);
          if (n < 0) break;
          continue;
        }
        long now = SystemClock.elapsedRealtime();
        AudioClassifier cls = analyzer;
        if (cls != null) {
          for (int i = 0; i < n; i++) {
            soundWindow[soundFilled++] = samples[i] / 32768f;
            if (soundFilled == soundWindow.length) {
              soundFilled = 0;
              // Never block the recorder thread on neural-network inference.
              ExecutorService worker = inferenceWorker;
              if (worker != null && inferenceBusy.compareAndSet(false, true)) {
                float[] windowCopy = soundWindow.clone();
                try { worker.execute(() -> {
                  try { classifyWindow(cls, windowCopy); }
                  finally { inferenceBusy.set(false); }
                }); }
                catch (java.util.concurrent.RejectedExecutionException ex) { inferenceBusy.set(false); }
              } else skippedInferenceWindows++;
            }
          }
        }
        if (now - lastReport < 250) continue;
        lastReport = now;
        double squares = 0;
        for (int i = 0; i < n; i++) squares += (double)samples[i] * samples[i];
        float rms = (float)(Math.sqrt(squares / n) / 32768.0);
        AudioDeviceInfo routed = rec.getRoutedDevice();
        if (routed != null) {
          actualInput = String.valueOf(routed.getProductName());
          actualKind = String.valueOf(routed.getType());
          actualInputType = routed.getType();
        }
        JSObject data = new JSObject();
        data.put("rms", rms); data.put("timestamp", System.currentTimeMillis());
        data.put("input", actualInput);
        notifyListeners("micLevel", data);
      }
    } catch (Exception ex) {
      if (capturing.get()) sendError("Сбой микрофона: " + ex.getMessage());
    } finally {
      // A read failure must not leave a recorder/microphone owned indefinitely.
      stopProbeInternal();
    }
  }

  private void classifyWindow(AudioClassifier cls, float[] samples) {
    try {
      AudioDataFormat format = AudioDataFormat.builder().setSampleRate(16000f).build();
      AudioData audioData = AudioData.create(format, samples.length);
      audioData.load(samples);
      AudioClassifierResult result = cls.classify(audioData);
      int sent = 0;
      for (ClassificationResult window : result.classificationResults()) {
        for (Classifications head : window.classifications()) {
          for (Category category : head.categories()) {
            if (sent >= 3 || category.score() < 0.18f) return;
            String label = category.categoryName();
            if (label == null || label.isEmpty()) continue;
            JSObject data = new JSObject();
            data.put("label", label);
            data.put("confidence", category.score());
            data.put("timestamp", System.currentTimeMillis());
            int t = actualInputType;
            String source = (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLE_HEADSET)
              ? "bluetoothMic" : (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_USB_HEADSET)
              ? "headsetMic" : "phoneMic";
            data.put("source", source);
            notifyListeners("yamnet", data);
            sent++;
          }
        }
      }
    } catch (Exception ex) {
      sendError("Ошибка YAMNet: " + ex.getMessage());
      // Keep microphone probe alive; classification errors do not block the UI.
    }
  }

  private void sendError(String message) {
    JSObject error = new JSObject(); error.put("message", message);
    notifyListeners("analysisError", error);
  }

  private void stopProbeInternal() {
    synchronized (captureLock) {
      capturing.set(false);
      AudioRecord rec = recorder; recorder = null;
      AudioClassifier cls = analyzer; analyzer = null;
      ExecutorService worker = inferenceWorker; inferenceWorker = null;
      if (worker != null) worker.shutdownNow();
      if (rec != null) {
        try { if (rec.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) rec.stop(); } catch (Exception ignored) {}
        try { rec.release(); } catch (Exception ignored) {}
      }
      if (cls != null) try { cls.close(); } catch (Exception ignored) {}
      actualInput = ""; actualKind = ""; actualInputType = -1;
    }
  }

  // Stopping an AudioRecord may wait for an in-flight microphone read or inference.
  // Never run the blocking release on the Android/Capacitor UI thread.
  private void stopAsync(PluginCall call) {
    new Thread(() -> {
      stopProbeInternal();
      JSObject result = new JSObject(); result.put("stopped", true); call.resolve(result);
    }, "SoundWorld-Mic-Stop").start();
  }

  @PluginMethod
  public void stopMicrophoneProbe(PluginCall call) { stopAsync(call); }

  @PluginMethod
  public void stopAnalysis(PluginCall call) { stopAsync(call); }

  @PluginMethod
  public void performanceSnapshot(PluginCall call) {
    JSObject result = new JSObject();
    ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
    if (am != null) {
      ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
      am.getMemoryInfo(memory);
      result.put("ramMb", memory.availMem / (1024L * 1024L));
      result.put("lowMemory", memory.lowMemory);
    }
    BatteryManager battery = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
    if (battery != null) {
      int capacity = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
      if (capacity >= 0 && capacity <= 100) result.put("battery", capacity);
    }
    PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
    if (power != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      result.put("thermalStatus", power.getCurrentThermalStatus());
    }
    result.put("elapsedSec", (SystemClock.elapsedRealtime() - appStartedAt) / 1000L);
    result.put("inferenceSkipped", skippedInferenceWindows);
    result.put("recording", capturing.get());
    // Never invent CPU temperature or audio glitches: they are not measured here.
    call.resolve(result);
  }

  @PluginMethod
  public void actualMicrophone(PluginCall call) {
    JSObject r = new JSObject();
    r.put("active", capturing.get());
    r.put("name", actualInput);
    r.put("kind", actualKind);
    r.put("output", "Не проверен");
    call.resolve(r);
  }

  @PluginMethod
  public void startSteps(PluginCall call) {
    if (!granted(Manifest.permission.ACTIVITY_RECOGNITION)) { call.reject("Разрешите физическую активность"); return; }
    if (sensorManager == null) sensorManager = (SensorManager)getContext().getSystemService(Context.SENSOR_SERVICE);
    if (sensorManager == null) {call.reject("Датчики недоступны");return;}
    stepDetector = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
    if (stepDetector == null) {call.reject("Датчик шагов отсутствует");return;}
    if (!listeningSteps) listeningSteps = sensorManager.registerListener(this, stepDetector, SensorManager.SENSOR_DELAY_NORMAL);
    if (!listeningSteps) {call.reject("Не удалось включить шагомер");return;}
    JSObject r = new JSObject();r.put("started", true);call.resolve(r);
  }

  @PluginMethod
  public void stopSteps(PluginCall call) {
    stopStepsInternal();
    JSObject r = new JSObject();r.put("stopped", true);call.resolve(r);
  }

  private void stopStepsInternal() {
    if (sensorManager != null) sensorManager.unregisterListener(this);
    listeningSteps = false;
  }

  @Override
  public void onSensorChanged(SensorEvent event) {
    if (!listeningSteps || event.sensor.getType() != Sensor.TYPE_STEP_DETECTOR) return;
    JSObject r = new JSObject();
    r.put("timestamp", System.currentTimeMillis());
    r.put("sensor", "TYPE_STEP_DETECTOR");
    notifyListeners("step", r);
  }

  @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}

  @Override protected void handleOnPause() {
    // Offload blocking recorder release to a worker. Background media service is separate.
    new Thread(this::stopProbeInternal, "SoundWorld-Lifecycle-Stop").start();
    stopStepsInternal();
    super.handleOnPause();
  }

  @Override protected void handleOnDestroy() {
    new Thread(this::stopProbeInternal, "SoundWorld-Destroy-Stop").start();
    stopStepsInternal();
    super.handleOnDestroy();
  }
}
