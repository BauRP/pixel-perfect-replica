package kz.soundworld.ar;

public final class SoundWorldPcmLifecyclePolicyTest {
  private static void check(String name, boolean expected, boolean actual) {
    if (expected != actual) throw new AssertionError(name + ": "+actual);
  }
  public static void main(String[] args) {
    check("service created before foreground",false,
      SoundWorldPcmLifecyclePolicy.canAccept(false,false,false,false));
    check("successful foreground startup",true,
      SoundWorldPcmLifecyclePolicy.canAccept(true,false,false,false));
    check("active PCM output",true,
      SoundWorldPcmLifecyclePolicy.canAccept(true,false,true,true));
    check("paused",false,
      SoundWorldPcmLifecyclePolicy.canAccept(true,true,true,true));
    check("stopped",false,
      SoundWorldPcmLifecyclePolicy.canAccept(false,true,false,false));
    check("AudioTrack shutdown still in progress",false,
      SoundWorldPcmLifecyclePolicy.canAccept(true,false,false,true));
    check("foreground startup refused",false,
      SoundWorldPcmLifecyclePolicy.canAccept(false,true,false,false));
    System.out.println("PASS: PCM lifecycle rejects early, stopped and stale audio");
  }
}
