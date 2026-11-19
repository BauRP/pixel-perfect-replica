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
      SoundWorldPlaybackService.EnqueueResult result = service.offerPcm(pcm);
      if (result == SoundWorldPlaybackService.EnqueueResult.UNAVAILABLE) {
        call.reject("Аудиослужба остановлена или PCM недопустим");
        return;
      }
      JSObject r=new JSObject();
      r.put("queued", result == SoundWorldPlaybackService.EnqueueResult.ACCEPTED);
      r.put("backpressure", result == SoundWorldPlaybackService.EnqueueResult.BACKPRESSURE);
      call.resolve(r);
    } catch(Exception ex) {call.reject("Ошибка PCM: "+ex.getMessage());}
  }

  @PluginMethod public void pause(PluginCall call) {
    SoundWorldPlaybackService s=SoundWorldPlaybackService.current();
    if(s!=null)s.pauseAudio();
    try {
      // Pause is terminal for this foreground service. Explicit Play starts
      // a fresh session, rather than leaving a silent persistent notification.
      getContext().stopService(new Intent(getContext(), SoundWorldPlaybackService.class));
      JSObject r=new JSObject();r.put("audible",false);call.resolve(r);
    } catch (Exception ex) {
      call.reject("Не удалось остановить фоновую музыку: " + ex.getMessage());
    }
  }

  @PluginMethod public void stop(PluginCall call) {
    // Stopping a service must not attempt to START it (Android background-start limits).
    Intent intent = new Intent(getContext(), SoundWorldPlaybackService.class);
    SoundWorldPlaybackService service = SoundWorldPlaybackService.current();
    try {
      if (service != null) service.pauseAudio(); // clear the queue immediately
      boolean stopped = getContext().stopService(intent);
      if (service != null && !stopped) {
        call.reject("Android не подтвердил остановку музыкальной службы");
        return;
      }
      JSObject r = new JSObject();
      r.put("requested", true); // the service's onDestroy is asynchronous
      r.put("alreadyStopped", !stopped && service == null);
      call.resolve(r);
    } catch (Exception ex) {
      call.reject("Не удалось остановить музыкальную службу: " + ex.getMessage());
    }
  }

  @PluginMethod public void status(PluginCall call) {
    SoundWorldPlaybackService s=SoundWorldPlaybackService.current();
    JSObject r=new JSObject();r.put("audible",s!=null&&s.isAudible());
    r.put("queuedChunks",s==null?0:s.bufferedChunks());
    r.put("serviceActive",s!=null);
    r.put("readyForPcm",s!=null&&s.readyForPcm());
    r.put("underruns",s==null?-1:s.measuredUnderruns());
    r.put("lastAudioError",s==null?"":s.audioError());
    call.resolve(r);
  }
}
