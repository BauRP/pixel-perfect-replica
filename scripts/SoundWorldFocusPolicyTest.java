package kz.soundworld.ar;

public final class SoundWorldFocusPolicyTest {
  private static void check(String label, boolean expected, boolean actual) {
    if (expected != actual) throw new AssertionError(label);
  }
  public static void main(String[] args) {
    check("allowed temporary call interruption",true,
      SoundWorldFocusPolicy.canAutoResume(true,true,false,true,true));
    check("user disabled automatic resume",false,
      SoundWorldFocusPolicy.canAutoResume(true,false,false,true,true));
    check("headset was unplugged",false,
      SoundWorldFocusPolicy.canAutoResume(true,true,true,true,true));
    check("user had paused music already",false,
      SoundWorldFocusPolicy.canAutoResume(false,true,false,true,true));
    check("WAV no longer prepared",false,
      SoundWorldFocusPolicy.canAutoResume(true,true,false,false,true));
    check("another playback is already ongoing",false,
      SoundWorldFocusPolicy.canAutoResume(true,true,false,true,false));
    System.out.println("PASS: real WAV auto-resume respects Android audio focus and user choice");
  }
}
