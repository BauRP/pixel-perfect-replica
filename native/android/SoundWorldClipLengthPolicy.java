package kz.soundworld.ar;

/** Hard lower/upper limits for a FINISHED locally generated WAV.
 * Raw audio may play before 60 seconds but is not published as a saved track
 * until the minimum duration is reached. A future continuous stream may
 * contain multiple complete 60–120 second segments.
 */
public final class SoundWorldClipLengthPolicy {
  private SoundWorldClipLengthPolicy() {}
  public static final long PCM_BYTES_PER_SECOND = 48_000L * 2 * 2;
  public static final long MIN_SAVE_PCM = 60L * PCM_BYTES_PER_SECOND;
  public static final long MAX_SAVE_PCM = 120L * PCM_BYTES_PER_SECOND;
  public static boolean canFinish(long bytes) {
    return bytes >= MIN_SAVE_PCM && bytes <= MAX_SAVE_PCM && bytes % 4 == 0;
  }
}
