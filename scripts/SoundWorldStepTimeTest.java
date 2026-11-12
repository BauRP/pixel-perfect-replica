package kz.soundworld.ar;
public final class SoundWorldStepTimeTest {
  private static void equal(String label, long expected, long actual) {
    if (expected != actual) throw new AssertionError(label + ": "+actual);
  }
  public static void main(String[] args) {
    long elapsed=15_000_000_000L, now=1_760_000_000_000L;
    equal("immediate",now,SoundWorldStepTime.eventEpochMillis(elapsed,elapsed,now));
    equal("delayed 0.8 seconds",now-800,
      SoundWorldStepTime.eventEpochMillis(elapsed-800_000_000L,elapsed,now));
    equal("cannot use arrival timestamp for 3s buffered steps",now-3000,
      SoundWorldStepTime.eventEpochMillis(elapsed-3_000_000_000L,elapsed,now));
    equal("future event",-1,SoundWorldStepTime.eventEpochMillis(elapsed+10,elapsed,now));
    equal("too old",-1,SoundWorldStepTime.eventEpochMillis(1,17_000_000_000L,now));
    equal("zero",-1,SoundWorldStepTime.eventEpochMillis(0,elapsed,now));
    System.out.println("PASS: hardware step timestamps preserve real cadence");
  }
}
