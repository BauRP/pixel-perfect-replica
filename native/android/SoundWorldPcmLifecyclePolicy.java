package kz.soundworld.ar;

/** Pure state gate for genuine, foreground-only PCM audio.
 * Prevents streaming to a service which has been created but not started,
 * paused, stopped, or is still tearing down its previous AudioTrack. */
public final class SoundWorldPcmLifecyclePolicy {
  private SoundWorldPcmLifecyclePolicy() {}
  public static boolean canAccept(boolean foregroundReady, boolean paused,
      boolean running, boolean writerActive) {
    return foregroundReady && !paused && (running || !writerActive);
  }
}
