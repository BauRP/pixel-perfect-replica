package kz.soundworld.ar;

/** Deterministic guard for returning to saved WAV after a temporary call/focus loss.
 * No platform APIs and no implicit startup of a new music session. */
public final class SoundWorldFocusPolicy {
  private SoundWorldFocusPolicy() {}
  public static boolean canAutoResume(boolean wasPlayingBeforeInterruption,
      boolean userAllowedAutoResume, boolean headsetDisconnected,
      boolean mediaPrepared, boolean currentlyPaused) {
    return wasPlayingBeforeInterruption && userAllowedAutoResume &&
      !headsetDisconnected && mediaPrepared && currentlyPaused;
  }
}
