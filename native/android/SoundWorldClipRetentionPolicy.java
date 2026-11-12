package kz.soundworld.ar;

/** Pure offline retention selection; does not touch files or Android APIs. */
public final class SoundWorldClipRetentionPolicy {
  private SoundWorldClipRetentionPolicy() {}

  /** -1 means all remaining clips are protected; never delete active audio. */
  public static int oldestEvictable(long[] creationTime, boolean[] protectedClip) {
    if (creationTime == null || protectedClip == null ||
        creationTime.length != protectedClip.length)
      throw new IllegalArgumentException("Inconsistent catalog metadata");
    int chosen=-1;
    long oldestAt=Long.MAX_VALUE;
    for (int i=0;i<creationTime.length;i++) {
      if (protectedClip[i]) continue;
      if (chosen==-1 || creationTime[i] < oldestAt) {
        chosen=i;
        oldestAt=creationTime[i];
      }
    }
    return chosen;
  }
}
