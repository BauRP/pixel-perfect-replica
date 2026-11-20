package kz.soundworld.ar;

public final class SoundWorldPcmLifecyclePolicyTest {
  private static void check(String name, boolean expected, boolean actual) {
    if (expected != actual) throw new AssertionError(name + ": "+actual);
  }
  public static void main(String[] args) {
    check("duplicate active START must not pause PCM",true,
      SoundWorldPcmLifecyclePolicy.ignoreDuplicateStart(true,false));
    check("restart after pause must prepare foreground again",false,
      SoundWorldPcmLifecyclePolicy.ignoreDuplicateStart(false,true));
    check("foreground not yet ready",false,
      SoundWorldPcmLifecyclePolicy.ignoreDuplicateStart(false,false));
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
    check("active generated PCM window is not stale", false,
      SoundWorldPcmLifecyclePolicy.idleExpired(1000, 120999, 120000));
    check("two-minute silent foreground session expires", true,
      SoundWorldPcmLifecyclePolicy.idleExpired(1000, 121000, 120000));
    check("clock reset is not an expiry", false,
      SoundWorldPcmLifecyclePolicy.idleExpired(121000, 1000, 120000));
    check("zero or negative last sample is unknown", false,
      SoundWorldPcmLifecyclePolicy.idleExpired(0, 121000, 120000));
    check("invalid timeout does not stop playback", false,
      SoundWorldPcmLifecyclePolicy.idleExpired(1000, 100000, 0));
    check("active full PCM queue is temporary backpressure",true,
      SoundWorldPcmLifecyclePolicy.canRetryFullQueue(true,false,true,true));
    check("paused PCM is not retryable",false,
      SoundWorldPcmLifecyclePolicy.canRetryFullQueue(true,true,true,true));
    check("stopped PCM is not retryable",false,
      SoundWorldPcmLifecyclePolicy.canRetryFullQueue(false,false,false,true));
    check("free PCM queue must not cause retries",false,
      SoundWorldPcmLifecyclePolicy.canRetryFullQueue(true,false,true,false));
    check("active output may initialize",true,
      SoundWorldPcmLifecyclePolicy.mayPrepareOutput(true,false,true));
    check("stop prevents restart",false,
      SoundWorldPcmLifecyclePolicy.mayPrepareOutput(false,true,false));
    check("pause prevents restart",false,
      SoundWorldPcmLifecyclePolicy.mayPrepareOutput(true,true,true));
    check("stopped writer prevents restart",false,
      SoundWorldPcmLifecyclePolicy.mayPrepareOutput(true,false,false));
    check("unready foreground prevents restart",false,
      SoundWorldPcmLifecyclePolicy.mayPrepareOutput(false,false,true));
    check("old session cannot enqueue after restart",false,
      SoundWorldPcmLifecyclePolicy.matchesSession(12,11));
    check("confirmed current session may enqueue",true,
      SoundWorldPcmLifecyclePolicy.matchesSession(12,12));
    check("zero session does not authorize audio",false,
      SoundWorldPcmLifecyclePolicy.matchesSession(0,0));
    check("negative session does not authorize audio",false,
      SoundWorldPcmLifecyclePolicy.matchesSession(12,-1));
    System.out.println("PASS: PCM lifecycle rejects early, stopped and stale audio");
  }
}
