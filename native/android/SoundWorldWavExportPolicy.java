package kz.soundworld.ar;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Strict byte-for-byte transfer of an already validated local WAV to MediaStore. */
public final class SoundWorldWavExportPolicy {
  private SoundWorldWavExportPolicy() {}

  public static long copyExactly(InputStream input, OutputStream output, long expectedBytes)
      throws IOException {
    if (input == null || output == null || expectedBytes <= 44 ||
        expectedBytes > 120L * 48000 * 4 + 44)
      throw new IOException("Invalid WAV export size or stream");
    byte[] buffer = new byte[65536];
    long copied = 0;
    int n;
    while ((n = input.read(buffer)) != -1) {
      if (n == 0) throw new IOException("WAV export made no read progress");
      if (copied + n > expectedBytes)
        throw new IOException("WAV changed during export (grew)");
      output.write(buffer, 0, n);
      copied += n;
    }
    if (copied != expectedBytes)
      throw new IOException("WAV changed during export (truncated)");
    output.flush();
    return copied;
  }

  /** Re-read exported MediaStore content and compare SHA-256 digests with
   * the original, bounded WAV. Refuse short/long or modified files.
   * The caller owns the streams and deletes incomplete MediaStore entries. */
  public static void verifyExactCopy(InputStream original, InputStream exported,
                                     long expectedBytes) throws IOException {
    if (original == null || exported == null || expectedBytes <= 44 ||
        expectedBytes > 120L * 48000 * 4 + 44)
      throw new IOException("Invalid WAV verification input");
    byte[] a = digestExactly(original, expectedBytes);
    byte[] b = digestExactly(exported, expectedBytes);
    if (!MessageDigest.isEqual(a, b))
      throw new IOException("Exported WAV differs from original audio");
  }

  private static byte[] digestExactly(InputStream input, long expectedBytes)
      throws IOException {
    final MessageDigest digest;
    try { digest = MessageDigest.getInstance("SHA-256"); }
    catch (NoSuchAlgorithmException ex) { throw new IOException("SHA-256 unavailable", ex); }
    byte[] buffer = new byte[65536];
    long read = 0;
    int n;
    while ((n=input.read(buffer)) != -1) {
      if (n == 0 || read + n > expectedBytes)
        throw new IOException("Unexpected WAV copy size");
      digest.update(buffer,0,n);
      read += n;
    }
    if (read != expectedBytes) throw new IOException("Incomplete WAV copy");
    return digest.digest();
  }
}
