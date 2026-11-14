package kz.soundworld.ar;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

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
}
