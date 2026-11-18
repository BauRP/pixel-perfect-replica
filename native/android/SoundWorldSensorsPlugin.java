package kz.soundworld.ar;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioDeviceInfo;
import android.media.AudioDeviceCallback;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.SystemClock;
import android.os.Handler;
import android.os.Looper;
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
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
  private final AtomicLong captureEpoch = new AtomicLong();
  private volatile long lastStopEpoch = 0;
  private volatile long activeCaptureEpoch = -1;
  // A new microphone session gets NEW inference flags, isolating old workers.
  private volatile AtomicBoolean inferenceHealthy = new AtomicBoolean(true);
  private AudioRecord recorder;
  private volatile AudioClassifier analyzer;
  private volatile boolean analysisActive = false;
  private ExecutorService inferenceWorker;
  private volatile AtomicBoolean inferenceBusy = new AtomicBoolean(false);
  private volatile int skippedInferenceWindows = 0;
  private final long appStartedAt = SystemClock.elapsedRealtime();
  private volatile int actualInputType = -1;
  // Reject queued YAMNet classification from a previous physical mic.
  private volatile long micRouteGeneration = 0;
  private volatile int captureRateHz = 0;
  private Thread captureThread;
  private SensorManager sensorManager;
  private Sensor stepDetector;
  private boolean listeningSteps = false;
  private volatile String actualInput = "";
  private volatile String actualKind = "";
  private volatile String inputPreference = "auto";
  private volatile String batteryMode = "auto";
  private volatile int analysisStride = 1;
  private volatile int scheduledWindows = 0;
  private volatile int batteryThrottledWindows = 0;
  private AudioManager routingManager;
  private AudioDeviceCallback audioDeviceObserver;
  // Serial rerouting is done off the Capacitor/Android UI thread. A device
  // disappearing never restarts the microphone or requests new permissions.
  private final ExecutorService routeWorker = Executors.newSingleThreadExecutor(r -> {
    Thread t = new Thread(r, "SoundWorld-Input-Route");
    t.setDaemon(true);
    return t;
  });

  private static boolean headsetInput(AudioDeviceInfo device) {
    int type = device.getType();
    return type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
      type == AudioDeviceInfo.TYPE_USB_HEADSET ||
      type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      type == AudioDeviceInfo.TYPE_BLE_HEADSET;
  }

  private AudioDeviceInfo preferredInputDevice() {
    AudioManager manager = routingManager;
    if (manager == null)
      manager = (AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);
    if (manager == null) return null;
    AudioDeviceInfo headset = null;
    AudioDeviceInfo builtIn = null;
    for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
      if (!device.isSource()) continue;
      if (headsetInput(device) && headset == null) headset = device;
      if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC && builtIn == null)
        builtIn = device;
    }
    // "headset" is a preference, not a promise that unplugged hardware exists.
    // "auto" retains existing headset-first behavior and "phone" favors built-in.
    return "phone".equals(inputPreference)
      ? (builtIn != null ? builtIn : headset)
      : (headset != null ? headset : builtIn);
  }

  private void updateActiveInputRoute() {
    try {
      routeWorker.execute(() -> {
        synchronized (captureLock) {
          AudioRecord active = recorder;
          if (active == null || !capturing.get()) return;
          try {
            // The route is only a requested preference. getRoutedDevice()
            // in the capture loop remains the authoritative actual route.
            active.setPreferredDevice(preferredInputDevice());
          } catch (RuntimeException ex) {
            sendError("Android не смог переключить микрофон: " + ex.getMessage());
          }
        }
      });
    } catch (java.util.concurrent.RejectedExecutionException ignored) {
      // Activity was destroyed; never restart capture for a stale device event.
    }
  }
  // Battery/thermal/LMK binder queries must never block AudioRecord.read().
  // Power policy is always enabled; it only runs on its own bounded worker.
  private volatile ExecutorService powerWorker;
  private volatile AtomicBoolean powerRefreshBusy = new AtomicBoolean(false);

  private int calculateAnalysisStride() {
    PowerManager power = (PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
    BatteryManager battery = (BatteryManager)getContext().getSystemService(Context.BATTERY_SERVICE);
    ActivityManager memory = (ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
    int thermal = power == null ? -1 : power.getCurrentThermalStatus();
    int batteryPercent = battery == null ? -1 :
      battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
    boolean lowRam = false;
    if (memory != null) {
      ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
      memory.getMemoryInfo(info);
      lowRam = info.lowMemory;
    }
    return SoundWorldPowerPolicy.analysisStride(
      batteryMode, thermal, batteryPercent, lowRam);
  }

  private void schedulePowerRefresh(long epoch) {
    ExecutorService worker = powerWorker;
    AtomicBoolean busy = powerRefreshBusy;
    if (worker == null || !busy.compareAndSet(false,true)) return;
    try {
      worker.execute(() -> {
        try {
          int next = calculateAnalysisStride();
          if (SoundWorldPowerEpochGuard.mayApply(
              epoch, activeCaptureEpoch, capturing.get()))
            analysisStride = next;
        } catch (RuntimeException ex) {
          // Keep previous safe policy until the next refresh; do not block
          // microphone capture or disable thermal/battery protections.
        } finally { busy.set(false); }
      });
    } catch (java.util.concurrent.RejectedExecutionException ex) {
      busy.set(false);
    }
  }

  @PluginMethod
  public void setBatteryMode(PluginCall call) {
    String requested = call.getString("mode", "auto");
    if (!"auto".equals(requested) && !"maxPerformance".equals(requested)) {
      call.reject("Неизвестный режим нагрузки"); return;
    }
    batteryMode = requested;
    // Apply the newly chosen mode to an ALREADY RUNNING YAMNet session,
    // not only after the next six analysis windows.
    if (capturing.get() && analysisActive) schedulePowerRefresh(activeCaptureEpoch);
    JSObject out = new JSObject();
    out.put("mode", requested);
    out.put("configured", true);
    call.resolve(out);
  }

  @Override public void load() {
    super.load();
    routingManager = (AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);
    if (routingManager != null) {
      audioDeviceObserver = new AudioDeviceCallback() {
        private void changed() {
          JSObject event = new JSObject();
          event.put("changed", true);
          notifyListeners("audioRouteChanged", event);
          updateActiveInputRoute();
        }
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices) { changed(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices) { changed(); }
      };
      routingManager.registerAudioDeviceCallback(audioDeviceObserver,
        new Handler(Looper.getMainLooper()));
    }
  }

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
    o.put("preferredInput", inputPreference);
    o.put("actualInputCategory", actualInputType == AudioDeviceInfo.TYPE_BUILTIN_MIC ? "phone" :
      (actualInputType == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
       actualInputType == AudioDeviceInfo.TYPE_USB_HEADSET ||
       actualInputType == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
       actualInputType == AudioDeviceInfo.TYPE_BLE_HEADSET) ? "headset" : "unknown");
    o.put("captureRateHz", captureRateHz);
    o.put("skippedInferenceWindows", skippedInferenceWindows);
    o.put("inferenceThrottled", batteryThrottledWindows);
    o.put("analysisStride", analysisStride);
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
    // A preference selected DURING an existing diagnostic is effective
    // immediately. Previously it was used only on the next Start.
    updateActiveInputRoute();
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
    long epoch=captureEpoch.incrementAndGet();
    new Thread(() -> openCapture(call, true, epoch), "SoundWorld-Yamnet-Init").start();
  }

  @PluginMethod
  public void startMicrophoneProbe(PluginCall call) {
    long epoch=captureEpoch.incrementAndGet();
    new Thread(() -> openCapture(call, false, epoch), "SoundWorld-Mic-Init").start();
  }

  /** All I/O and model initialization happens off the Android UI thread. */
  private void openCapture(PluginCall call, boolean classify, long epoch) {
    if (!granted(Manifest.permission.RECORD_AUDIO)) {
      call.reject("Требуется разрешение микрофона");
      return;
    }
    synchronized (captureLock) {
      if(epoch!=captureEpoch.get()) {call.reject("Запуск микрофона отменён");return;}
      if (capturing.get()) {
        // A rapid Stop -> Start must not reuse the OLD recorder and then
        // report success just before the queued stop closes it.
        if (activeCaptureEpoch < lastStopEpoch) {
          stopProbeInternal(); // captureLock is reentrant; not Android UI thread
        } else {
          if (analysisActive != classify) {
            call.reject("Сначала остановите предыдущую проверку микрофона"); return;
          }
          JSObject r = new JSObject(); r.put("started", true); call.resolve(r); return;
        }
      }
      // Prefer native YAMNet 16kHz microphone input. If a handset rejects
      // that format, capture genuine mono 48kHz PCM and anti-alias it to 16k.
      int captureRate = 16000;
      int min = AudioRecord.getMinBufferSize(captureRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (min <= 0) {
        captureRate = 48000;
        min = AudioRecord.getMinBufferSize(captureRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      }
      if (min <= 0) { call.reject("Микрофон не поддерживает 16 или 48 кГц PCM"); return; }
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
        if (epoch != captureEpoch.get()) throw new IllegalStateException("Запуск отменён");
        try {
          rec = new AudioRecord(MediaRecorder.AudioSource.MIC, captureRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(min * 2, captureRate / 5));
        } catch (IllegalArgumentException unsupported16k) {
          if (captureRate != 16000) throw unsupported16k;
          // Some HALs throw instead of returning STATE_UNINITIALIZED.
          captureRate = 48000;
          min = AudioRecord.getMinBufferSize(captureRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
          if (min <= 0) throw new IllegalStateException("Микрофон не поддерживает 16 или 48 кГц", unsupported16k);
          rec = new AudioRecord(MediaRecorder.AudioSource.MIC, captureRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(min * 2, captureRate / 5));
        }
        if (rec.getState() != AudioRecord.STATE_INITIALIZED && captureRate == 16000) {
          // A few Android audio HALs report a valid minimum 16k buffer but
          // reject the actual AudioRecord initialization. Retry once at 48k.
          rec.release();
          captureRate = 48000;
          min = AudioRecord.getMinBufferSize(captureRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
          if (min <= 0) throw new IllegalStateException("Микрофон не поддерживает 16 или 48 кГц");
          rec = new AudioRecord(MediaRecorder.AudioSource.MIC, captureRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(min * 2, captureRate / 5));
        }
        if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Микрофон не инициализирован");
        // Use the identical selection policy at Start and for hot-plug
        // changes. No fallback from a genuine recorder to an invented device.
        AudioDeviceInfo best = preferredInputDevice();
        if (best != null) rec.setPreferredDevice(best);
        if (epoch != captureEpoch.get()) throw new IllegalStateException("Запуск отменён");
        try {
          rec.startRecording();
          if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING)
            throw new IllegalStateException("Захват микрофона не начался");
        } catch (RuntimeException initialError) {
          if (captureRate != 16000 || initialError instanceof SecurityException)
            throw initialError;
          // Some HALs report valid 16kHz but fail only at startRecording().
          // Retry genuine 48kHz PCM with the existing local FIR resampler.
          try { rec.release(); } catch (RuntimeException ignored) {}
          rec = null;
          captureRate = 48000;
          min = AudioRecord.getMinBufferSize(captureRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
          if (min <= 0)
            throw new IllegalStateException("Резервные 48 кГц не поддерживаются", initialError);
          rec = new AudioRecord(MediaRecorder.AudioSource.MIC, captureRate,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            Math.max(min * 2, captureRate / 5));
          if (rec.getState() != AudioRecord.STATE_INITIALIZED)
            throw new IllegalStateException("Резервный микрофон 48 кГц не инициализирован", initialError);
          AudioDeviceInfo fallback = preferredInputDevice();
          if (fallback != null) rec.setPreferredDevice(fallback);
          if (epoch != captureEpoch.get()) throw new IllegalStateException("Запуск отменён");
          rec.startRecording();
          if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING)
            throw new IllegalStateException("Резервный микрофон 48 кГц не начал запись", initialError);
        }
        recorder = rec;
        captureRateHz = captureRate;
        analyzer = preparedClassifier;
        analysisActive = classify;
        if (preparedClassifier != null) inferenceWorker = Executors.newSingleThreadExecutor(r -> {
          Thread t = new Thread(r, "SoundWorld-Yamnet-Worker");t.setDaemon(true);return t;
        });
        AudioDeviceInfo routed = rec.getRoutedDevice();
        actualInput = routed != null ? String.valueOf(routed.getProductName()) : "Маршрут ещё не определён";
        actualKind = routed != null ? String.valueOf(routed.getType()) : "unknown";
        actualInputType = routed != null ? routed.getType() : -1;
        micRouteGeneration++;
        skippedInferenceWindows = 0;
        inferenceHealthy = new AtomicBoolean(true);
        inferenceBusy = new AtomicBoolean(false);
        scheduledWindows = 0;
        batteryThrottledWindows = 0;
        analysisStride = 1;
        if (epoch != captureEpoch.get()) throw new IllegalStateException("Запуск отменён");
        activeCaptureEpoch = epoch;
        capturing.set(true);
        powerRefreshBusy = new AtomicBoolean(false);
        if (classify) {
          // A plain microphone routing probe does no YAMNet inference and
          // should not run periodic battery/thermal Binder queries.
          powerWorker = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r,"SoundWorld-Power-Policy");
            t.setDaemon(true);
            return t;
          });
          schedulePowerRefresh(epoch);
        }
        final AudioRecord active = rec;
        final int activeSampleRate = captureRate;
        final AtomicBoolean sessionBusy = inferenceBusy;
        final AtomicBoolean sessionHealthy = inferenceHealthy;
        captureThread = new Thread(() -> readMic(active, epoch, activeSampleRate, sessionBusy, sessionHealthy), "SoundWorld-Microphone-Probe");
        captureThread.setDaemon(true);
        captureThread.start();
        JSObject r = new JSObject(); r.put("started", true); call.resolve(r);
      } catch (Exception ex) {
        // A failed capture start must release EVERY resource opened so far,
        // including both policy and inference workers, and never leave a
        // running AudioRecord holding the phone microphone.
        capturing.set(false);
        ExecutorService failedInference = inferenceWorker; inferenceWorker = null;
        if (failedInference != null) failedInference.shutdownNow();
        if (rec != null) {
          try {
            if (rec.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) rec.stop();
          } catch (Exception ignored) {}
          try { rec.release(); } catch (Exception ignored) {}
        }
        if (preparedClassifier != null) try { preparedClassifier.close(); } catch (Exception ignored) {}
        if (powerWorker != null) powerWorker.shutdownNow();
        powerWorker = null;
        recorder = null; analyzer = null; analysisActive = false;
        activeCaptureEpoch = -1;
        actualInput = ""; actualKind = ""; captureRateHz = 0;
        call.reject("Не удалось открыть микрофон: " + ex.getMessage());
      }
    }
  }

  private boolean currentCapture(AudioRecord rec, long epoch) {
    return SoundWorldCapturePolicy.canEmit(rec, recorder, epoch, activeCaptureEpoch, capturing.get());
  }

  private void readMic(AudioRecord rec, long epoch, int sampleRate, AtomicBoolean busy, AtomicBoolean healthy) {
    short[] samples = new short[sampleRate / 10];
    final SoundWorldMicResampler resampler = sampleRate == 48000 ? new SoundWorldMicResampler() : null;
    long lastReport = 0;
    // 15600 samples = 975 ms, the input window required by YAMNet.
    final float[] soundWindow = new float[15600];
    int soundFilled = 0;
    int priorInputType = -1;
    int priorInputDeviceId = -1;
    try {
      while (currentCapture(rec, epoch)) {
        int n = rec.read(samples, 0, samples.length);
        if (!currentCapture(rec, epoch)) break;
        if (n <= 0) {
          if (n < 0) sendError("Ошибка чтения микрофона: " + n);
          if (n < 0) break;
          continue;
        }
        // Do not combine samples from two distinct microphones into one
        // YAMNet window. A headset hotplug can happen during AudioRecord.read.
        AudioDeviceInfo inputNow = rec.getRoutedDevice();
        int newInputType = inputNow != null ? inputNow.getType() : -1;
        int newInputDeviceId = inputNow != null ? inputNow.getId() : -1;
        if (newInputDeviceId >= 0 && priorInputDeviceId >= 0 &&
            (newInputDeviceId != priorInputDeviceId || newInputType != priorInputType)) {
          micRouteGeneration++;
          soundFilled = 0;
          java.util.Arrays.fill(soundWindow, 0f);
          if (resampler != null) resampler.reset();
        }
        if (newInputDeviceId >= 0) {
          priorInputType = newInputType;
          priorInputDeviceId = newInputDeviceId;
        }
        long now = SystemClock.elapsedRealtime();
        AudioClassifier cls = analyzer;
        if (cls != null && healthy.get()) {
          for (int i = 0; i < n; i++) {
            float mapped = resampler == null ? samples[i] / 32768f : resampler.push(samples[i]);
            if (Float.isNaN(mapped)) continue; // 48kHz FIR emits one genuine 16kHz sample per 3 inputs
            soundWindow[soundFilled++] = mapped;
            if (soundFilled == soundWindow.length) {
              soundFilled = 0;
              // Refresh thermal/battery conditions roughly every six windows.
              int windowNumber = ++scheduledWindows;
              if (windowNumber % 6 == 0) schedulePowerRefresh(epoch);
              // Real capture continues; only duplicate heavy inference is
              // throttled. Even under severe heat process every third window.
              if (windowNumber % analysisStride != 0) {
                batteryThrottledWindows++;
                continue;
              }
              // Never block the recorder thread on neural-network inference.
              ExecutorService worker = inferenceWorker;
              if (worker != null && busy.compareAndSet(false, true)) {
                float[] windowCopy = soundWindow.clone();
                final long scheduledGeneration = micRouteGeneration;
                final int scheduledInputType = priorInputType;
                try { worker.execute(() -> {
                  try {
                    if (currentCapture(rec, epoch) &&
                        scheduledGeneration == micRouteGeneration)
                      classifyWindow(cls, windowCopy, rec, epoch, healthy,
                        scheduledGeneration, scheduledInputType);
                  } finally {
                    java.util.Arrays.fill(windowCopy, 0f);
                    busy.set(false);
                  }
                }); }
                catch (java.util.concurrent.RejectedExecutionException ex) {
                  java.util.Arrays.fill(windowCopy, 0f);
                  busy.set(false);
                }
              } else skippedInferenceWindows++;
            }
          }
        }
        if (now - lastReport < 250) continue;
        if (!currentCapture(rec, epoch)) break;
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
      java.util.Arrays.fill(samples, (short)0);
      java.util.Arrays.fill(soundWindow, 0f);
      // A read failure must not leave a recorder/microphone owned indefinitely.
      synchronized (captureLock) {
        if (recorder == rec) stopProbeInternal();
      }
    }
  }

  private void classifyWindow(AudioClassifier cls, float[] samples,
                              AudioRecord rec, long epoch, AtomicBoolean healthy,
                              long scheduledGeneration, int scheduledInputType) {
    try {
      if (!currentCapture(rec, epoch)) return;
      AudioDataFormat format = AudioDataFormat.builder().setSampleRate(16000f).build();
      AudioData audioData = AudioData.create(format, samples.length);
      audioData.load(samples);
      AudioClassifierResult result = cls.classify(audioData);
      if (!currentCapture(rec, epoch) || scheduledGeneration != micRouteGeneration) return;
      int sent = 0;
      for (ClassificationResult window : result.classificationResults()) {
        for (Classifications head : window.classifications()) {
          for (Category category : head.categories()) {
            if (!currentCapture(rec, epoch) || scheduledGeneration != micRouteGeneration) return;
            if (sent >= 3 || category.score() < 0.18f) return;
            String label = category.categoryName();
            if (label == null || label.isEmpty()) continue;
            JSObject data = new JSObject();
            data.put("label", label);
            data.put("confidence", category.score());
            data.put("timestamp", System.currentTimeMillis());
            String source = (scheduledInputType == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
              scheduledInputType == AudioDeviceInfo.TYPE_BLE_HEADSET)
              ? "bluetoothMic" : (scheduledInputType == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
              scheduledInputType == AudioDeviceInfo.TYPE_USB_HEADSET)
              ? "headsetMic" : "phoneMic";
            data.put("source", source);
            notifyListeners("yamnet", data);
            sent++;
          }
        }
      }
    } catch (Exception ex) {
      if (currentCapture(rec, epoch) && healthy.getAndSet(false))
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
      activeCaptureEpoch = -1;
      micRouteGeneration++;
      AudioRecord rec = recorder; recorder = null;
      AudioClassifier cls = analyzer; analyzer = null;
      analysisActive = false;
      ExecutorService worker = inferenceWorker; inferenceWorker = null;
      ExecutorService policy = powerWorker; powerWorker = null;
      if (policy != null) policy.shutdownNow();
      if (worker != null) worker.shutdownNow();
      if (rec != null) {
        try { if (rec.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) rec.stop(); } catch (Exception ignored) {}
        try { rec.release(); } catch (Exception ignored) {}
      }
      // MediaPipe must never close while a background inference still uses it.
      if (cls != null) {
        if (worker == null || worker.isTerminated()) {
          try { cls.close(); } catch (Exception ignored) {}
        } else {
          final ExecutorService closingWorker = worker;
          Thread closing = new Thread(() -> {
            boolean interrupted = false;
            boolean finished = false;
            long deadline = SystemClock.elapsedRealtime() + 6000;
            while (SystemClock.elapsedRealtime() < deadline) {
              try { if (closingWorker.awaitTermination(1, TimeUnit.SECONDS)) { finished = true; break; } }
              catch (InterruptedException ex) { interrupted = true; }
            }
            // Never close a MediaPipe classifier while native inference still
            // uses it. Bound the cleanup wait instead of leaking a waiting thread.
            if (finished) {
              try { cls.close(); } catch (Exception ignored) {}
            } else sendError("YAMNet не завершила фоновую обработку за 6 секунд");
            if (interrupted) Thread.currentThread().interrupt();
          }, "SoundWorld-Yamnet-Close");
          closing.setDaemon(true);
          closing.start();
        }
      }
      actualInput = ""; actualKind = ""; actualInputType = -1; captureRateHz = 0;
    }
  }

  // Stopping an AudioRecord may wait for an in-flight microphone read or inference.
  // Never run the blocking release on the Android/Capacitor UI thread.
  private void stopAsync(PluginCall call) {
    long requestedEpoch = captureEpoch.incrementAndGet(); // cancel a pending startup
    lastStopEpoch = requestedEpoch;
    new Thread(() -> {
      synchronized (captureLock) {
        // An old stop cannot close a newer recording, but it must close the
        // recording that existed when Stop was requested.
        if (activeCaptureEpoch < requestedEpoch) stopProbeInternal();
      }
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
    result.put("inferenceThrottled", batteryThrottledWindows);
    result.put("analysisStride", analysisStride);
    result.put("analysisActive", analysisActive);
    result.put("captureRateHz", captureRateHz);
    result.put("batteryMode", batteryMode);
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
    long when=SoundWorldStepTime.eventEpochMillis(
      event.timestamp, SystemClock.elapsedRealtimeNanos(), System.currentTimeMillis());
    if (when<0) return; // Reject stale or invalid hardware event clock.
    r.put("timestamp", when);
    r.put("sensor", "TYPE_STEP_DETECTOR");
    notifyListeners("step", r);
  }

  @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}

  private void stopForLifecycle(String threadName) {
    long epoch = captureEpoch.incrementAndGet();
    lastStopEpoch = epoch;
    new Thread(() -> {
      synchronized (captureLock) {
        if (activeCaptureEpoch < epoch) stopProbeInternal();
      }
    }, threadName).start();
  }

  @Override protected void handleOnPause() {
    // Offload blocking recorder release to a worker. Background media service is separate.
    stopForLifecycle("SoundWorld-Lifecycle-Stop");
    stopStepsInternal();
    super.handleOnPause();
  }

  @Override protected void handleOnDestroy() {
    if (routingManager != null && audioDeviceObserver != null) {
      routingManager.unregisterAudioDeviceCallback(audioDeviceObserver);
      audioDeviceObserver = null;
    }
    routeWorker.shutdownNow();
    stopForLifecycle("SoundWorld-Destroy-Stop");
    stopStepsInternal();
    super.handleOnDestroy();
  }
}
