package kz.soundworld.ar;

import android.content.Intent;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PCM sink only. No WebView UI is allowed to claim LIVE from an accepted buffer:
 * status().audible is true only after AudioTrack actually writes valid PCM.
 */
@CapacitorPlugin(name = "SoundWorldPlayback")
public class SoundWorldPlaybackPlugin extends Plugin {
  @PluginMethod public void start(PluginCall call) {
    // Caller must have a real local generator and explicit user Play gesture.
    Intent intent = new Intent(getContext(), SoundWorldPlaybackService.class)
      .setAction(SoundWorldPlaybackService.ACTION_START);
    try {
      ContextCompat.startForegroundService(getContext(), intent);
      JSObject r = new JSObject();r.put("preparing", true);call.resolve(r);
    } catch (Exception ex) { call.reject("Не удалось открыть музыкальную службу: " + ex.getMessage()); }
  }

  @PluginMethod public void appendPcm(PluginCall call) {
    String data = call.getString("base64");
    if (data == null || data.length() > 275000) {call.reject("Недопустимый PCM фрагмент");return;}
    SoundWorldPlaybackService service = SoundWorldPlaybackService.current();
    if (service == null) {call.reject("Музыкальная служба не запущена");return;}
    try {
      byte[] pcm = Base64.decode(data, Base64.DEFAULT);
      if (!service.offerPcm(pcm)) {call.reject("Буфер заполнен, остановлен или аудио недопустимо");return;}
      JSObject r=new JSObject();r.put("queued",true);call.resolve(r);
    } catch(Exception ex) {call.reject("Ошибка PCM: "+ex.getMessage());}
  }

  @PluginMethod public void pause(PluginCall call) {
    SoundWorldPlaybackService s=SoundWorldPlaybackService.current();
    if(s!=null)s.pauseAudio();
    JSObject r=new JSObject();r.put("audible",false);call.resolve(r);
  }

  @PluginMethod public void stop(PluginCall call) {
    Intent intent = new Intent(getContext(), SoundWorldPlaybackService.class)
      .setAction(SoundWorldPlaybackService.ACTION_STOP);
    try { getContext().startService(intent); } catch(Exception ignored) {}
    JSObject r=new JSObject();r.put("requested",true);call.resolve(r);
  }

  @PluginMethod public void status(PluginCall call) {
    SoundWorldPlaybackService s=SoundWorldPlaybackService.current();
    JSObject r=new JSObject();r.put("audible",s!=null&&s.isAudible());
    r.put("queuedChunks",s==null?0:s.bufferedChunks());
    r.put("serviceActive",s!=null);
    call.resolve(r);
  }
}
