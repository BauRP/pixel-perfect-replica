package kz.soundworld.ar;
public final class SoundWorldClipLengthPolicyTest {
  private static void check(String name, boolean expected, long bytes) {
    if (SoundWorldClipLengthPolicy.canFinish(bytes) != expected)
      throw new AssertionError(name + ": " + bytes);
  }
  public static void main(String[] args) {
    long sec = SoundWorldClipLengthPolicy.PCM_BYTES_PER_SECOND;
    check("11s forbidden", false, 11 * sec);
    check("59s forbidden", false, 59 * sec);
    check("60s accepted", true, 60 * sec);
    check("120s accepted", true, 120 * sec);
    check("over 120s", false, 121 * sec);
    check("partial audio frame", false, 60 * sec + 1);
    check("empty", false, 0);
    System.out.println("PASS: completed WAV must be 60 to 120 seconds");
  }
}
