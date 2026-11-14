package kz.soundworld.ar;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;

public final class SoundWorldWavExportPolicyTest {
  private static int checks;
  private static void check(boolean good, String name) {
    checks++;
    if (!good) throw new AssertionError(name);
  }
  private static void rejected(byte[] bytes, long expected, String name) throws Exception {
    boolean rejected = false;
    try {
      SoundWorldWavExportPolicy.copyExactly(
        new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), expected);
    } catch (IOException expectedFailure) { rejected = true; }
    check(rejected, name);
  }
  public static void main(String[] args) throws Exception {
    byte[] wav = new byte[100_001];
    for (int i = 0; i < wav.length; i++) wav[i] = (byte)(i * 37);
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    long copied = SoundWorldWavExportPolicy.copyExactly(
      new ByteArrayInputStream(wav), output, wav.length);
    check(copied == wav.length, "full WAV byte count");
    check(Arrays.equals(wav, output.toByteArray()), "exact WAV bytes");
    rejected(wav, wav.length + 1L, "truncated export rejected");
    rejected(wav, wav.length - 1L, "extra bytes rejected");
    rejected(wav, 44, "header-only rejected");
    rejected(wav, 120L * 48000 * 4 + 45L, "oversized WAV rejected");
    boolean failedWrite = false;
    try {
      SoundWorldWavExportPolicy.copyExactly(new ByteArrayInputStream(wav),
        new OutputStream() {
          @Override public void write(int b) throws IOException { throw new IOException("disk full"); }
          @Override public void write(byte[] b, int off, int len) throws IOException {
            throw new IOException("disk full");
          }
        }, wav.length);
    } catch (IOException expectedFailure) { failedWrite = true; }
    check(failedWrite, "failed MediaStore write rejected");
    System.out.println("SoundWorldWavExportPolicyTest: " + checks + " checks passed");
  }
}
