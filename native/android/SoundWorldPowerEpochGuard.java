package kz.soundworld.ar;

/** Immutable ownership check for asynchronous Android battery/thermal reads.
 * Power state from an old microphone run must never update a newer run. */
public final class SoundWorldPowerEpochGuard {
  private SoundWorldPowerEpochGuard() {}
  public static boolean mayApply(long readingEpoch, long activeEpoch, boolean capturing) {
    return capturing && readingEpoch > 0 && readingEpoch == activeEpoch;
  }
}
