package kz.soundworld.ar;

public final class SoundWorldCapturePolicyTest {
  private static void check(String label, boolean expected, boolean actual) {
    if (expected != actual) throw new AssertionError(label);
  }
  public static void main(String[] args) {
    Object old = new Object(), next = new Object();
    check("active recorder", true, SoundWorldCapturePolicy.canEmit(old, old, 3, 3, true));
    check("stopped recording", false, SoundWorldCapturePolicy.canEmit(old, old, 3, 3, false));
    check("different recorder", false, SoundWorldCapturePolicy.canEmit(old, next, 3, 3, true));
    check("old inference after restart", false, SoundWorldCapturePolicy.canEmit(old, old, 3, 4, true));
    check("null recorder", false, SoundWorldCapturePolicy.canEmit(null, null, 3, 3, true));
    check("invalid epoch", false, SoundWorldCapturePolicy.canEmit(old, old, -1, -1, true));
    System.out.println("PASS: YAMNet capture ownership prevents stale events");
  }
}
