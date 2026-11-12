package kz.soundworld.ar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.media.MediaPlayer;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Real WAV playback independently of the WebView lifecycle. This service never
 * synthesizes audio, opens a microphone, auto-starts on boot, or guesses a clip.
 * A validated user-selected local recording is the ONLY accepted input.
 */
public final class SoundWorldClipPlaybackService extends Service {
  public static final String ACTION_PLAY = "kz.soundworld.ar.CLIP_PLAY";
  public static final String ACTION_RESUME = "kz.soundworld.ar.CLIP_RESUME";
  public static final String ACTION_PAUSE = "kz.soundworld.ar.CLIP_PAUSE";
  public static final String ACTION_STOP = "kz.soundworld.ar.CLIP_STOP";
  public static final String EXTRA_CLIP_ID = "clipId";
  public static final String EXTRA_AUTO_RESUME = "resumeAfterCall";
  private static final String CHANNEL = "soundworld_saved_music";
  private static final int NOTIFICATION_ID = 416;
  private static final long MAX_WAV_BYTES = 120L * 48000 * 4 + 44;
  private static volatile SoundWorldClipPlaybackService active;

  public interface PlaybackListener {
    void onPlayback(String state, String clipId, String error);
  }
  private static volatile PlaybackListener listener;
  public static SoundWorldClipPlaybackService current() { return active; }
  public static void setListener(PlaybackListener observer) {
    listener = observer;
    SoundWorldClipPlaybackService service = active;
    if (observer != null && service != null) observer.onPlayback(service.state, service.clipId, service.lastError);
  }

  /** Old Activities may destroy after a new one has already attached. */
  public static void clearListener(PlaybackListener expected) {
    if (listener == expected) listener = null;
  }

  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile String state = "stopped";
  private volatile String clipId = "";
  private volatile String lastError = "";
  private boolean resumeAfterCall = false;
  private boolean focusResumePending = false;
  private boolean unplugged = false;
  private int generation = 0;
  private boolean playerPrepared = false;
  private Runnable prepareDeadline;
  private AudioManager audioManager;
  private AudioFocusRequest focusRequest;
  private MediaPlayer player;
  private MediaSession session;
  private NotificationManager notifications;
  private BroadcastReceiver noisyReceiver;

  public String playbackState() { return state; }
  public String playbackClipId() { return clipId; }
  public String playbackError() { return lastError; }
  public int playbackPositionMs() {
    MediaPlayer current = player;
    if (current == null || !playerPrepared) return 0;
    try { return Math.max(0, current.getCurrentPosition()); }
    catch (RuntimeException ex) { return 0; }
  }
  public int playbackDurationMs() {
    MediaPlayer current = player;
    if (current == null || !playerPrepared) return 0;
    try { return Math.max(0, current.getDuration()); }
    catch (RuntimeException ex) { return 0; }
  }
  public String routedOutput() {
    MediaPlayer current = player;
    if (current == null || !playerPrepared) return "";
    try {
      AudioDeviceInfo device = current.getRoutedDevice();
      return device == null ? "" : String.valueOf(device.getProductName());
    } catch (RuntimeException ex) { return ""; }
  }
  public String routedOutputType() {
    MediaPlayer current = player;
    if (current == null || !playerPrepared) return "";
    try {
      AudioDeviceInfo device = current.getRoutedDevice();
      return device == null ? "" : String.valueOf(device.getType());
    } catch (RuntimeException ex) { return ""; }
  }

  @Override public void onCreate() {
    super.onCreate();
    active = this;
    audioManager = (AudioManager)getSystemService(Context.AUDIO_SERVICE);
    notifications = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
    if (notifications != null) {
      notifications.createNotificationChannel(new NotificationChannel(
        CHANNEL, "SoundWorld AR — сохранённая музыка", NotificationManager.IMPORTANCE_LOW));
    }
    session = new MediaSession(this, "SoundWorld Saved Music");
    session.setCallback(new MediaSession.Callback() {
      @Override public void onPlay() { main.post(() -> resumeInternal()); }
      @Override public void onPause() { main.post(() -> pauseInternal(false)); }
      @Override public void onStop() { main.post(() -> stopInternal()); }
      @Override public void onSeekTo(long pos) {
        // System MediaSession scrubber is allowed to seek only the active,
        // prepared recording. Uses the same ID-checked native gate as UI.
        requestSeek(clipId, pos, accepted -> {});
      }
    });
    session.setActive(true);
    updateMediaState();
    noisyReceiver = new BroadcastReceiver() {
      @Override public void onReceive(Context context, Intent intent) {
        if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
          unplugged = true;
          pauseInternal(false);
        }
      }
    };
    IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
    try {
      registerReceiver(noisyReceiver, filter);
    } catch (SecurityException ex) {
      if (Build.VERSION.SDK_INT >= 33)
        registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
      else throw ex;
    }
  }

  private PendingIntent serviceAction(String action, int code) {
    Intent intent = new Intent(this, SoundWorldClipPlaybackService.class).setAction(action);
    return PendingIntent.getService(this, code, intent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private Notification notification() {
    boolean activePlayback = "playing".equals(state);
    String detail = "preparing".equals(state) ? "Подготовка WAV…" :
      activePlayback ? "Воспроизведение сохранённой музыки" :
      "Пауза сохранённой музыки";
    Notification.Builder builder = new Notification.Builder(this, CHANNEL)
      .setContentTitle("SoundWorld AR")
      .setContentText(detail)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()));
    builder.addAction(activePlayback ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
      activePlayback ? "Пауза" : "Играть",
      serviceAction(activePlayback ? ACTION_PAUSE : ACTION_RESUME, 19));
    builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп",
      serviceAction(ACTION_STOP, 20));
    return builder.build();
  }

  private void publish(String next) {
    state = next;
    updateMediaState();
    PlaybackListener l = listener;
    if (l != null) l.onPlayback(next, clipId, lastError);
    // Error is delivered once; stop/destroy must not repeat a stale failure.
    if ("stopped".equals(next)) lastError = "";
    if (!"stopped".equals(next) && notifications != null) {
      try { notifications.notify(NOTIFICATION_ID, notification()); }
      catch (RuntimeException ex) { Log.w("SoundWorldSaved", "Notification update failed", ex); }
    }
  }

  private void updateMediaState() {
    MediaSession s = session;
    if (s == null) return;
    int playback = "playing".equals(state) ? PlaybackState.STATE_PLAYING :
      "preparing".equals(state) ? PlaybackState.STATE_BUFFERING :
      "paused".equals(state) ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_STOPPED;
    try {
      s.setPlaybackState(new PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SEEK_TO)
        .setState(playback, playerPrepared ? playbackPositionMs() : PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          "playing".equals(state) ? 1f : 0f).build());
    } catch (RuntimeException ex) { Log.w("SoundWorldSaved", "MediaSession state failed", ex); }
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_STOP : intent.getAction();
    if (ACTION_PLAY.equals(action)) {
      // Must enter foreground immediately, before MediaPlayer.prepareAsync.
      try { startForeground(NOTIFICATION_ID, notification()); }
      catch (RuntimeException ex) {
        lastError = "Не удалось включить фоновое воспроизведение: " + ex.getMessage();
        Log.e("SoundWorldSaved", lastError, ex);
        stopInternal();
        return START_NOT_STICKY;
      }
      String requested = intent.getStringExtra(EXTRA_CLIP_ID);
      resumeAfterCall = intent.getBooleanExtra(EXTRA_AUTO_RESUME, false);
      playInternal(requested);
    } else if (ACTION_RESUME.equals(action)) {
      if (player == null) { stopSelf(startId); return START_NOT_STICKY; }
      resumeInternal();
    } else if (ACTION_PAUSE.equals(action)) {
      if (player == null) { stopSelf(startId); return START_NOT_STICKY; }
      pauseInternal(false);
    } else {
      stopInternal();
    }
    return START_NOT_STICKY;
  }

  private File verifiedWav(String id) throws Exception {
    if (id == null || !id.matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"))
      throw new IllegalArgumentException("Неверный ID музыкального фрагмента");
    File dir = new File(getFilesDir(), "generated_music");
    File file = new File(dir, id + ".wav");
    if (!file.getCanonicalFile().getParentFile().equals(dir.getCanonicalFile()) ||
        !file.isFile() || file.length() <= 44 || file.length() > MAX_WAV_BYTES)
      throw new IllegalArgumentException("Настоящий WAV не найден");
    try (RandomAccessFile wav = new RandomAccessFile(file, "r")) {
      byte[] h = new byte[44];
      wav.readFully(h);
      if (!"RIFF".equals(new String(h, 0, 4, StandardCharsets.US_ASCII)) ||
          !"WAVE".equals(new String(h, 8, 4, StandardCharsets.US_ASCII)) ||
          !"fmt ".equals(new String(h, 12, 4, StandardCharsets.US_ASCII)) ||
          !"data".equals(new String(h, 36, 4, StandardCharsets.US_ASCII)))
        throw new IllegalArgumentException("Повреждён заголовок WAV");
      long riff = uint32(h, 4), format = uint16(h, 20), channels = uint16(h, 22);
      long rate = uint32(h, 24), bytesPerSecond = uint32(h, 28), data = uint32(h, 40);
      if (riff != file.length() - 8 || data != file.length() - 44 ||
          format != 1 || channels != 2 || rate != 48000 || bytesPerSecond != 192000 ||
          uint32(h, 16) != 16 || uint16(h, 34) != 16 || uint16(h, 32) != 4 || data % 4 != 0)
        throw new IllegalArgumentException("WAV имеет неверный формат или размер");
    }
    return file;
  }

  private static long uint32(byte[] b, int at) {
    return (b[at] & 255L) | ((b[at+1] & 255L) << 8) |
      ((b[at+2] & 255L) << 16) | ((b[at+3] & 255L) << 24);
  }
  private static int uint16(byte[] b, int at) {
    return (b[at] & 255) | ((b[at+1] & 255) << 8);
  }

  private boolean acquireFocus() {
    if (audioManager == null) { lastError = "Аудиосистема Android недоступна"; return false; }
    if (focusRequest != null) return true;
    final int myGeneration = generation;
    AudioAttributes attrs = new AudioAttributes.Builder()
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .setUsage(AudioAttributes.USAGE_MEDIA).build();
    AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(attrs)
      .setOnAudioFocusChangeListener(change -> {
        if (myGeneration != generation) return;
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
          if (focusResumePending && resumeAfterCall && !unplugged) {
            focusResumePending = false;
            resumeInternal();
          }
        } else if (change == AudioManager.AUDIOFOCUS_LOSS) {
          focusResumePending = false;
          pauseInternal(true);
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
                   change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
          focusResumePending = "playing".equals(state) && resumeAfterCall;
          pauseInternal(true);
        }
      }, main).build();
    if (audioManager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      lastError = "Android не предоставил аудиофокус";
      return false;
    }
    focusRequest = request;
    return true;
  }

  private void abandonFocus() {
    if (audioManager != null && focusRequest != null)
      audioManager.abandonAudioFocusRequest(focusRequest);
    focusRequest = null;
  }

  private void playInternal(String requestedId) {
    if (requestedId != null && requestedId.equals(clipId) && "paused".equals(state)) {
      unplugged = false;
      resumeInternal();
      return;
    }
    releasePlayer();
    generation++;
    lastError = "";
    playerPrepared = false;
    focusResumePending = false;
    unplugged = false;
    try {
      File file = verifiedWav(requestedId);
      clipId = requestedId;
      publish("preparing");
      MediaPlayer next = new MediaPlayer();
      player = next;
      AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
      next.setAudioAttributes(attrs);
      next.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
      next.setDataSource(file.getAbsolutePath());
      prepareDeadline = () -> {
        if (next == player && !playerPrepared)
          failPlayback("Android не подготовил WAV за 15 секунд");
      };
      main.postDelayed(prepareDeadline, 15000);
      next.setOnPreparedListener(mp -> {
        if (mp != player) return;
        if (prepareDeadline != null) main.removeCallbacks(prepareDeadline);
        prepareDeadline = null;
        playerPrepared = true;
        if (session != null) {
          try {
            session.setMetadata(new MediaMetadata.Builder()
              .putString(MediaMetadata.METADATA_KEY_TITLE, "Сохранённый WAV — SoundWorld AR")
              .putLong(MediaMetadata.METADATA_KEY_DURATION, mp.getDuration()).build());
          } catch (RuntimeException ex) {
            Log.w("SoundWorldSaved", "Media metadata unavailable", ex);
          }
        }
        if (!"preparing".equals(state)) return; // pause requested while preparing
        if (!acquireFocus()) { failPlayback(lastError); return; }
        try {
          mp.start();
          publish("playing");
        } catch (RuntimeException ex) {
          failPlayback("AudioTrack отказал в запуске WAV: " + ex.getMessage());
        }
      });
      next.setOnCompletionListener(mp -> {
        if (mp == player) stopInternal();
      });
      next.setOnErrorListener((mp, what, extra) -> {
        if (mp == player) failPlayback("MediaPlayer: " + what + "/" + extra);
        return true;
      });
      next.prepareAsync();
    } catch (Exception ex) {
      failPlayback("Не удалось открыть настоящий WAV: " + ex.getMessage());
    }
  }

  private void resumeInternal() {
    if (player == null || !"paused".equals(state)) return;
    if (!playerPrepared) {
      // MediaPlayer is still preparing; resume it from onPrepared safely.
      publish("preparing");
      return;
    }
    try {
      if (!acquireFocus()) { failPlayback(lastError); return; }
      player.start();
      focusResumePending = false;
      publish("playing");
    } catch (RuntimeException ex) {
      failPlayback("Не удалось продолжить WAV: " + ex.getMessage());
    }
  }

  private void pauseInternal(boolean interrupted) {
    if (!interrupted) focusResumePending = false;
    if (player == null || "stopped".equals(state)) return;
    try {
      if ("playing".equals(state)) player.pause();
      publish("paused");
    } catch (RuntimeException ex) {
      failPlayback("Не удалось поставить WAV на паузу: " + ex.getMessage());
    }
  }

  private void releasePlayer() {
    if (prepareDeadline != null) main.removeCallbacks(prepareDeadline);
    prepareDeadline = null;
    MediaPlayer previous = player;
    player = null;
    playerPrepared = false;
    if (previous != null) {
      try { previous.setOnCompletionListener(null); } catch (Exception ignored) {}
      try { previous.setOnPreparedListener(null); } catch (Exception ignored) {}
      try { previous.setOnErrorListener(null); } catch (Exception ignored) {}
      try { previous.release(); } catch (Exception ignored) {}
    }
    abandonFocus();
  }

  private void failPlayback(String reason) {
    lastError = reason;
    Log.e("SoundWorldSaved", reason);
    stopInternal();
  }

  private void stopInternal() {
    generation++;
    focusResumePending = false;
    releasePlayer();
    clipId = "";
    publish("stopped");
    if (session != null) session.setMetadata(null);
    try { stopForeground(STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {}
    stopSelf();
  }

  /** Seek within a real, already-prepared WAV; acknowledge request only,
   * not completion. Same ID check prevents an old UI from seeking a new clip. */
  public void requestSeek(String requestedId, long ms, java.util.function.Consumer<Boolean> done) {
    main.post(() -> {
      if (player == null || !playerPrepared ||
          (!"playing".equals(state) && !"paused".equals(state)) ||
          requestedId == null || !requestedId.equals(clipId) || ms < 0) {
        done.accept(false);
        return;
      }
      try {
        int duration=player.getDuration();
        if (duration <= 0) { done.accept(false); return; }
        player.seekTo((int)Math.min(ms, (long)duration));
        updateMediaState();
        done.accept(true);
      } catch (RuntimeException ex) {
        Log.w("SoundWorldSaved", "Seek rejected", ex);
        done.accept(false);
      }
    });
  }

  public void requestPause() { main.post(() -> pauseInternal(false)); }
  public void requestStop() { main.post(this::stopInternal); }
  public void stopIfClip(String id) {
    main.post(() -> { if (id != null && id.equals(clipId)) stopInternal(); });
  }

  @Override public void onDestroy() {
    generation++;
    releasePlayer();
    clipId = "";
    publish("stopped");
    if (noisyReceiver != null) {
      try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) {}
      noisyReceiver = null;
    }
    if (session != null) {
      session.setActive(false);
      session.release();
      session = null;
    }
    if (active == this) active = null;
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
