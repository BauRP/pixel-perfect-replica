package kz.soundworld.ar;

/**
 * Convert Android sensor elapsed-realtime nanoseconds to epoch milliseconds.
 * Arrival-time timestamps distort walking/running cadence when the Android
 * sensor queue delivers multiple genuine events together.
 */
public final class SoundWorldStepTime {
  private SoundWorldStepTime() {}

  public static long eventEpochMillis(long eventNanos, long elapsedNanos, long wallMillis) {
    if (eventNanos <= 0 || elapsedNanos <= 0 || wallMillis <= 0 ||
        eventNanos > elapsedNanos) return -1;
    long delayMs=(elapsedNanos-eventNanos)/1_000_000L;
    // A long delayed or wrong-clock event cannot be an active step cadence.
    if (delayMs > 15_000 || delayMs > wallMillis) return -1;
    return wallMillis-delayMs;
  }
}
