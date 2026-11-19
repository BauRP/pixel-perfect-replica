package kz.soundworld.ar;

/** Pure state gate for genuine, foreground-only PCM audio.
 * Prevents streaming to a service which has been created but not started,
 * paused, stopped, or is still tearing down its previous AudioTrack. */
public final class SoundWorldPcmLifecyclePolicy {
  private SoundWorldPcmLifecyclePolicy() {}
  /** A duplicate START must preserve an already-running AudioTrack and queue. */
  public static boolean ignoreDuplicateStart(boolean foregroundReady, boolean paused) {
    return foregroundReady && !paused;
  }
  public static boolean canAccept(boolean foregroundReady, boolean paused,
      boolean running, boolean writerActive) {
    return foregroundReady && !paused && (running || !writerActive);
  }
  /** A full active queue means WAIT, never silently drop or duplicate PCM. */
  public static boolean canRetryFullQueue(boolean foregroundReady, boolean paused,
      boolean running, boolean queueFull) {
    return foregroundReady && !paused && running && queueFull;
  }
  /** Real PCM starvation is bounded without making up samples or music. */
  public static boolean idleExpired(long lastRealPcmMs, long nowMs, long limitMs) {
    return lastRealPcmMs > 0 && nowMs >= lastRealPcmMs && limitMs > 0 &&
      nowMs - lastRealPcmMs >= limitMs;
  }
}
