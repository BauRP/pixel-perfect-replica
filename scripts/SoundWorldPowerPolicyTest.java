package kz.soundworld.ar;

public final class SoundWorldPowerPolicyTest {
  private static void check(String label, int expected, int actual) {
    if (actual != expected)
      throw new AssertionError(label + ": expected " + expected + ", got " + actual);
  }
  public static void main(String[] args) {
    check("normal auto", 1, SoundWorldPowerPolicy.analysisStride("auto", 0, 65, false));
    check("weak battery", 2, SoundWorldPowerPolicy.analysisStride("auto", 0, 12, false));
    check("warm", 2, SoundWorldPowerPolicy.analysisStride("auto", 3, 85, false));
    check("hot", 3, SoundWorldPowerPolicy.analysisStride("auto", 4, 85, false));
    check("critical", 3, SoundWorldPowerPolicy.analysisStride("auto", 5, 85, false));
    check("low RAM", 2, SoundWorldPowerPolicy.analysisStride("auto", 0, 85, true));
    check("performance overrides low battery", 1, SoundWorldPowerPolicy.analysisStride("maxPerformance", 0, 8, false));
    check("performance respects severe heat", 2, SoundWorldPowerPolicy.analysisStride("maxPerformance", 3, 85, false));
    check("performance respects critical heat", 3, SoundWorldPowerPolicy.analysisStride("maxPerformance", 6, 85, false));
    check("battery unavailable", 1, SoundWorldPowerPolicy.analysisStride("auto", 0, -1, false));
    System.out.println("PASS: native YAMNet thermal and battery scheduling policy");
  }
}
