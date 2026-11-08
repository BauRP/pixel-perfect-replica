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
  private Thread captureThread;
  private SensorManager sensorManager;
  private Sensor stepDetector;
  private boolean listeningSteps = false;
  private volatile String actualInput = "";
  private volatile String actualKind = "";

  private boolean granted(String permission) {
    return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
  }

  @PluginMethod
  public void status(PluginCall call) {
    JSObject o = new JSObject();
    o.put("yamnetIncluded", false); // no actual neural model bundled yet
    o.put("microphoneGranted", granted(Manifest.permission.RECORD_AUDIO));
    o.put("activityGranted", granted(Manifest.permission.ACTIVITY_RECOGNITION));
    SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    o.put("stepsSupported", sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) != null);
    o.put("recording", capturing.get());
    o.put("actualInput", actualInput);
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
    // Actual YAMNet inference is not yet implemented: refuse rather than pretend.
    call.reject("Локальная модель YAMNet ещё не установлена");
  }

  @PluginMethod
  public void startMicrophoneProbe(PluginCall call) {
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
      try {
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
            if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_USB_HEADSET
              || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
              best = d; break;
            }
          }
          // Android may reject the preference; always report the actual routed device.
          if (best != null) rec.setPreferredDevice(best);
        }
        rec.startRecording();
        if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Захват микрофона не начался");
        recorder = rec;
        AudioDeviceInfo routed = rec.getRoutedDevice();
        actualInput = routed != null ? String.valueOf(routed.getProductName()) : "Маршрут ещё не определён";
        actualKind = routed != null ? String.valueOf(routed.getType()) : "unknown";
        capturing.set(true);
        final AudioRecord active = rec;
        captureThread = new Thread(() -> readMic(active), "SoundWorld-Microphone-Probe");
        captureThread.setDaemon(true);
        captureThread.start();
        JSObject r = new JSObject(); r.put("started", true); call.resolve(r);
      } catch (Exception ex) {
        capturing.set(false);
        if (rec != null) { try { rec.release(); } catch (Exception ignored) {} }
        recorder = null; actualInput = ""; actualKind = "";
        call.reject("Не удалось открыть микрофон: " + ex.getMessage());
      }
    }
  }

  private void readMic(AudioRecord rec) {
    short[] samples = new short[1600];
    long lastReport = 0;
    try {
      while (capturing.get()) {
        int n = rec.read(samples, 0, samples.length);
        if (n <= 0) {
          if (n < 0) sendError("Ошибка чтения микрофона: " + n);
          if (n < 0) break;
          continue;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastReport < 250) continue;
        lastReport = now;
        double squares = 0;
        for (int i = 0; i < n; i++) squares += (double)samples[i] * samples[i];
        float rms = (float)(Math.sqrt(squares / n) / 32768.0);
        AudioDeviceInfo routed = rec.getRoutedDevice();
        if (routed != null) {
          actualInput = String.valueOf(routed.getProductName());
          actualKind = String.valueOf(routed.getType());
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

  private void sendError(String message) {
    JSObject error = new JSObject(); error.put("message", message);
    notifyListeners("analysisError", error);
  }

  private void stopProbeInternal() {
    synchronized (captureLock) {
      capturing.set(false);
      AudioRecord rec = recorder; recorder = null;
      if (rec != null) {
        try { if (rec.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) rec.stop(); } catch (Exception ignored) {}
        try { rec.release(); } catch (Exception ignored) {}
      }
      actualInput = ""; actualKind = "";
    }
  }

  @PluginMethod
  public void stopMicrophoneProbe(PluginCall call) {
    stopProbeInternal();
    JSObject result = new JSObject(); result.put("stopped", true); call.resolve(result);
  }

  @PluginMethod
  public void stopAnalysis(PluginCall call) {
    stopProbeInternal();
    JSObject result = new JSObject(); result.put("stopped", true); call.resolve(result);
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
    // Do not capture microphone without active visible diagnostic session.
    // Future background music uses a separate, audited foreground service.
    stopProbeInternal(); stopStepsInternal();
    super.handleOnPause();
  }

  @Override protected void handleOnDestroy() {
    stopProbeInternal(); stopStepsInternal();
    super.handleOnDestroy();
  }
}
