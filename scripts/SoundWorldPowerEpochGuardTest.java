package kz.soundworld.ar;
public final class SoundWorldPowerEpochGuardTest {
  private static void check(String message, boolean expected, boolean result) {
    if(expected != result) throw new AssertionError(message);
  }
  public static void main(String[] args) {
    check("current microphone",true,SoundWorldPowerEpochGuard.mayApply(6,6,true));
    check("stopped microphone",false,SoundWorldPowerEpochGuard.mayApply(6,6,false));
    check("old thermal response",false,SoundWorldPowerEpochGuard.mayApply(5,6,true));
    check("invalid epoch",false,SoundWorldPowerEpochGuard.mayApply(0,0,true));
    check("old response cannot revive new capture",false,SoundWorldPowerEpochGuard.mayApply(6,-1,true));
    System.out.println("PASS: Android thermal policy applied only to current recording");
  }
}
