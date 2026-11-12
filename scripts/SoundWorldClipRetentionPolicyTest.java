package kz.soundworld.ar;

public final class SoundWorldClipRetentionPolicyTest {
  private static void equal(String name, int expected, int actual) {
    if (actual != expected) throw new AssertionError(name + ": " + actual);
  }
  public static void main(String[] args) {
    // An orphaned old WAV may be recovered AFTER the newest three recordings.
    equal("old restored file, not first indexed file",3,
      SoundWorldClipRetentionPolicy.oldestEvictable(
        new long[]{400,300,200,100},new boolean[]{false,false,false,false}));
    equal("currently playing oldest file stays protected",2,
      SoundWorldClipRetentionPolicy.oldestEvictable(
        new long[]{400,300,200,100},new boolean[]{false,false,false,true}));
    equal("favorite/export/recovered entries stay protected",1,
      SoundWorldClipRetentionPolicy.oldestEvictable(
        new long[]{100,200,300},new boolean[]{true,false,true}));
    equal("all protected", -1,
      SoundWorldClipRetentionPolicy.oldestEvictable(
        new long[]{100,200},new boolean[]{true,true}));
    equal("empty catalog", -1,
      SoundWorldClipRetentionPolicy.oldestEvictable(new long[]{},new boolean[]{}));
    System.out.println("PASS: chronological WAV retention preserves active and protected recordings");
  }
}
