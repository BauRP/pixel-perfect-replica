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
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Real 48kHz stereo PCM output sink for a future LOCAL generative model.
 * It cannot create music. It does NOT generate dummy samples or begin playback
 * unless real PCM has been submitted. The source must be a user-initiated session.
 */
public final class SoundWorldPlaybackService extends Service {
  public static final String ACTION_START = "kz.soundworld.ar.AUDIO_START";
  public static final String ACTION_PAUSE = "kz.soundworld.ar.AUDIO_PAUSE";
  public static final String ACTION_STOP = "kz.soundworld.ar.AUDIO_STOP";
  private static final String CHANNEL = "soundworld_music";
  private static final int NOTIFICATION_ID = 412;
  private static volatile SoundWorldPlaybackService active;
  private final ArrayBlockingQueue<byte[]> chunks = new ArrayBlockingQueue<>(16);
  private final AtomicBoolean running = new AtomicBoolean(false);
  private final AtomicBoolean writerActive = new AtomicBoolean(false);
  private final AtomicBoolean paused = new AtomicBoolean(false);
  // True only after Android has acknowledged a foreground music session.
  private final AtomicBoolean foregroundReady = new AtomicBoolean(false);
  private volatile boolean actualPlayback = false;
  private volatile AudioTrack audioTrack;
  private volatile int lastUnderruns = -1; // -1 means not measured
  private volatile String lastAudioError = "";
  private AudioManager audioManager;
  private AudioFocusRequest focusRequest;
  private MediaSession session;
  private Thread writer;
  private BroadcastReceiver unplug;
  // A foreground service that never receives real generated samples should
  // not consume power and display an indefinite "waiting for audio" notice.
  private static final long NEVER_FED_TIMEOUT_MS = 120_000L;
  private static final long STALLED_STREAM_TIMEOUT_MS = 120_000L;
  private final Handler idleHandler = new Handler(Looper.getMainLooper());
  private final Runnable noFirstPcm = () -> {
    if (foregroundReady.get() && !writerActive.get()) {
      lastAudioError = "Генератор не передал настоящие PCM за две минуты";
      pauseAudio();
      stopSelf();
    }
  };

  public static SoundWorldPlaybackService current() { return active; }

  @Override public void onCreate() {
    super.onCreate();
    active = this;
    NotificationManager notifications = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
    if (notifications != null) {
      notifications.createNotificationChannel(new NotificationChannel(
        CHANNEL, "SoundWorld AR музыка", NotificationManager.IMPORTANCE_LOW));
    }
    audioManager = (AudioManager)getSystemService(AUDIO_SERVICE);
    session = new MediaSession(this, "SoundWorld AR");
    session.setCallback(new MediaSession.Callback() {
      @Override public void onPause() { pauseAudio(); stopSelf(); }
      @Override public void onStop() { pauseAudio(); stopSelf(); }
    });
    session.setActive(true);
    publishState(false);
    unplug = new BroadcastReceiver() {
      @Override public void onReceive(Context context, Intent intent) {
        // Never switch from headphones to loudspeaker unexpectedly.
        if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
          pauseAudio();
          // A disconnected headset must not leave a silent foreground service.
          stopSelf();
        }
      }
    };
    IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
    // Only receives the system ACTION_AUDIO_BECOMING_NOISY broadcast.
    // Android exempts system-only broadcasts from dynamic export flags.
    try {
      registerReceiver(unplug, filter);
    } catch (SecurityException ex) {
      if (Build.VERSION.SDK_INT >= 33)
        registerReceiver(unplug, filter, Context.RECEIVER_NOT_EXPORTED);
      else throw ex;
    }
  }

  private Notification notification(String message) {
    Intent pause = new Intent(this, SoundWorldPlaybackService.class).setAction(ACTION_PAUSE);
    PendingIntent pauseIntent = PendingIntent.getService(
      this, 7, pause, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Intent stop = new Intent(this, SoundWorldPlaybackService.class).setAction(ACTION_STOP);
    PendingIntent stopIntent = PendingIntent.getService(
      this, 8, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    return new Notification.Builder(this, CHANNEL)
      .setContentTitle("SoundWorld AR")
      .setContentText(message)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()))
      .addAction(android.R.drawable.ic_media_pause, "Пауза", pauseIntent)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stopIntent)
      .build();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_STOP : intent.getAction();
    if (ACTION_STOP.equals(action)) {
      pauseAudio();
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    if (ACTION_PAUSE.equals(action)) {
      pauseAudio();
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    if (!ACTION_START.equals(action)) { pauseAudio(); stopSelf(startId); return START_NOT_STICKY; }
    // A second START request must never pause an already active PCM writer.
    if (SoundWorldPcmLifecyclePolicy.ignoreDuplicateStart(foregroundReady.get(),paused.get()))
      return START_NOT_STICKY;
    foregroundReady.set(false);
    paused.set(true); // never accept PCM before the foreground notification exists
    try {
      startForeground(NOTIFICATION_ID, notification("Ожидание настоящего аудио"));
      lastAudioError = "";
      lastUnderruns = -1;
      paused.set(false);
      foregroundReady.set(true);
      idleHandler.removeCallbacks(noFirstPcm);
      idleHandler.postDelayed(noFirstPcm, NEVER_FED_TIMEOUT_MS);
    } catch (RuntimeException ex) {
      lastAudioError = "Android отказал в запуске фонового звука: " + ex.getMessage();
      pauseAudio();
      stopSelf(startId);
    }
    return START_NOT_STICKY; // Android must never auto-restart mic or audio by itself
  }

  /** Returns false when there is no active session or the bounded queue is full. */
  public synchronized boolean offerPcm(byte[] pcm) {
    // 16-bit stereo: samples must align to 4 bytes; <1s at 48kHz; never store ambient microphone data.
    if (!readyForPcm() || pcm == null || pcm.length == 0 ||
        pcm.length % 4 != 0 || pcm.length > 192000) return false;
    if (!running.get() && writerActive.get()) return false; // previous AudioTrack is still releasing
    if (writerActive.compareAndSet(false, true)) {
      running.set(true);
      if (!chunks.offer(pcm)) {
        running.set(false);
        writerActive.set(false);
        return false;
      }
      writer = new Thread(this::writeAudio, "SoundWorld-PCM-Output");
      writer.setDaemon(true);
      writer.start();
    } else if (!running.get() || !chunks.offer(pcm)) return false;
    // This service is now backed by real PCM from an actual producer.
    idleHandler.removeCallbacks(noFirstPcm);
    return true; // queued, not necessarily audible yet
  }

  private void writeAudio() {
    try {
      if (audioManager == null) { lastAudioError = "Аудиосистема Android недоступна"; return; }
      long lastRealPcmAt = SystemClock.elapsedRealtime();
      focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        .setOnAudioFocusChangeListener(change -> {
          if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
              change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            pauseAudio();
            // A phone call or another app wins focus; no silent background
            // notification, no automatic restart after the interruption.
            stopSelf();
          }
        }).build();
      if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        lastAudioError = "Android не предоставил аудиофокус";return;
      }
      int min = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
      if (min <= 0) { lastAudioError = "Устройство не поддерживает PCM 48 кГц"; return; }
      audioTrack = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build())
        .setBufferSizeInBytes(Math.max(min * 4, 38400))
        .setTransferMode(AudioTrack.MODE_STREAM).build();
      if (audioTrack.getState() != AudioTrack.STATE_INITIALIZED) {
        lastAudioError = "AudioTrack не инициализирован";return;
      }
      while (running.get() && !paused.get()) {
        byte[] pcm = chunks.poll(500, TimeUnit.MILLISECONDS);
        if (pcm == null) {
          if (SoundWorldPcmLifecyclePolicy.idleExpired(
              lastRealPcmAt, SystemClock.elapsedRealtime(), STALLED_STREAM_TIMEOUT_MS)) {
            lastAudioError = "Поток настоящего PCM не поступал две минуты";
            foregroundReady.set(false);
            running.set(false);
            stopSelf();
            break;
          }
          // Do not claim real music when no generated samples exist.
          if (actualPlayback) {
            actualPlayback = false; publishState(false);
            lastUnderruns = audioTrack.getUnderrunCount();
            audioTrack.pause();
          }
          continue;
        }
        lastRealPcmAt = SystemClock.elapsedRealtime();
        if (audioTrack.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) audioTrack.play();
        int at = 0;
        while (at < pcm.length && running.get() && !paused.get()) {
          int written = audioTrack.write(pcm, at, pcm.length - at, AudioTrack.WRITE_BLOCKING);
          if (written <= 0) {
            lastAudioError = "AudioTrack не принял PCM: код " + written;
            running.set(false); break;
          }
          at += written;
        }
        lastUnderruns = audioTrack.getUnderrunCount();
        // A pause/stop may race the final AudioTrack.write return. Never
        // publish PLAYING after the user or Android already stopped output.
        if (at == pcm.length && running.get() && !paused.get() && !actualPlayback) {
          actualPlayback = true; publishState(true);
        }
      }
    } catch (Exception ex) {
      lastAudioError = ex.getClass().getSimpleName() + ": " + String.valueOf(ex.getMessage());
      actualPlayback = false;
      publishState(false);
    } finally {
      // MediaSession must never remain PLAYING when the writer exits due to
      // an audio focus error, interrupted write, or normal output shutdown.
      actualPlayback = false;
      publishState(false);
      if (!lastAudioError.isEmpty()) foregroundReady.set(false);
      releaseAudio();
      running.set(false);
      writerActive.set(false);
    }
  }

  private void publishState(boolean playing) {
    MediaSession currentSession = session;
    if (currentSession == null) return;
    PlaybackState state = new PlaybackState.Builder()
      .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP)
      .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
        PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f).build();
    try { currentSession.setPlaybackState(state); } catch (IllegalStateException ignored) {}
  }

  public synchronized void pauseAudio() {
    idleHandler.removeCallbacks(noFirstPcm);
    foregroundReady.set(false);
    paused.set(true);
    running.set(false);
    chunks.clear();
    publishState(false);
    actualPlayback = false;
    // Never resume automatically after focus loss or an unplug event.
  }

  /** The native bridge may enqueue only while foreground playback is ready. */
  public boolean readyForPcm() {
    return SoundWorldPcmLifecyclePolicy.canAccept(
      foregroundReady.get(), paused.get(), running.get(), writerActive.get());
  }

  public boolean isAudible() { return actualPlayback && running.get() && !paused.get(); }
  public int bufferedChunks() { return chunks.size(); }
  public int measuredUnderruns() { return lastUnderruns; }
  public String audioError() { return lastAudioError; }

  private void releaseAudio() {
    AudioTrack track = audioTrack;
    audioTrack = null;
    if (track != null) {
      try { track.pause(); } catch (Exception ignored) {}
      try { track.flush(); } catch (Exception ignored) {}
      try { track.release(); } catch (Exception ignored) {}
    }
    if (audioManager != null && focusRequest != null) {
      audioManager.abandonAudioFocusRequest(focusRequest);
      focusRequest = null;
    }
  }

  @Override public void onDestroy() {
    idleHandler.removeCallbacks(noFirstPcm);
    pauseAudio();
    if (unplug != null) { try { unregisterReceiver(unplug); } catch(Exception ignored) {} }
    MediaSession oldSession = session; session = null;
    if (oldSession != null) {oldSession.setActive(false);oldSession.release();}
    active = null;
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
