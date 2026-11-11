package kz.soundworld.ar;

/** Pure capture ownership check, independent of Android APIs. */
public final class SoundWorldCapturePolicy {
  private SoundWorldCapturePolicy() {}
  public static boolean canEmit(Object eventRecorder, Object currentRecorder,
                                long eventEpoch, long currentEpoch, boolean capturing) {
    return capturing && eventRecorder != null && eventRecorder == currentRecorder &&
           eventEpoch >= 0 && eventEpoch == currentEpoch;
  }
}
