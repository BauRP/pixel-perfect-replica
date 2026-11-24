package kz.soundworld.ar;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Explicitly requested local report: no Logcat permission, network or audio. */
@CapacitorPlugin(name = "SoundWorldFreeze")
public final class SoundWorldFreezePlugin extends Plugin {
  @PluginMethod public void pulse(PluginCall call) {
    SoundWorldFreezeMonitor.pulse();
    call.resolve();
  }
  @PluginMethod public void traceScreen(PluginCall call) {
    SoundWorldFreezeMonitor.traceScreen(call.getString("screen", ""));
    call.resolve();
  }
  @PluginMethod public void recordJsIssue(PluginCall call) {
    SoundWorldFreezeMonitor.recordJsIssue(getContext(), call.getString("kind", ""));
    call.resolve();
  }
  @PluginMethod public void read(PluginCall call) {
    Context context = getContext().getApplicationContext();
    Thread worker = new Thread(() -> {
      try {
        SharedPreferences preferences = context.getSharedPreferences(
          SoundWorldFreezeMonitor.PREFS, Context.MODE_PRIVATE);
        JSObject output = new JSObject();
        output.put("report", preferences.getString(SoundWorldFreezeMonitor.REPORT, ""));
        output.put("recordedAt", preferences.getLong(SoundWorldFreezeMonitor.AT, 0L));
        output.put("jsIssue", preferences.getString(SoundWorldFreezeMonitor.ISSUE, ""));
        output.put("jsIssueAt", preferences.getLong(SoundWorldFreezeMonitor.ISSUE_AT, 0L));
        call.resolve(output);
      } catch (Exception ex) {
        call.reject("Локальная диагностика временно недоступна");
      }
    }, "SoundWorld-Freeze-Read");
    worker.setDaemon(true);
    worker.start();
  }
  @PluginMethod public void copy(PluginCall call) {
    String content = call.getString("text", "");
    if (content == null || content.isEmpty() || content.length() > 12000) {
      call.reject("Нет отчёта для копирования");
      return;
    }
    Context context = getContext().getApplicationContext();
    Thread worker = new Thread(() -> {
      try {
        ClipboardManager clipboard =
          (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) { call.reject("Буфер обмена Android недоступен"); return; }
        clipboard.setPrimaryClip(ClipData.newPlainText("SoundWorld AR — отчёт об ошибках", content));
        call.resolve();
      } catch (Exception ex) {
        call.reject("Не удалось скопировать отчёт");
      }
    }, "SoundWorld-Freeze-Clipboard");
    worker.setDaemon(true);
    worker.start();
  }
}
