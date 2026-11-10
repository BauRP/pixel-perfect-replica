package kz.soundworld.ar;

/**
 * Bounded thermal/battery policy for YAMNet window scheduling.
 * Always processes some real windows: 1 = every ~975ms, 3 = every ~2.9s.
 * Does not touch microphone permission, playback output, or model quality.
 */
public final class SoundWorldPowerPolicy {
  private SoundWorldPowerPolicy() {}

  public static int analysisStride(String mode, int thermalStatus, int batteryPercent, boolean lowMemory) {
    if (thermalStatus >= 5) return 3; // severe Android thermal pressure
    if (thermalStatus >= 4 || lowMemory) return 2;
    if ("maxPerformance".equals(mode)) return 1;
    if (thermalStatus >= 3 || (batteryPercent >= 0 && batteryPercent <= 15)) return 2;
    return 1;
  }
}
