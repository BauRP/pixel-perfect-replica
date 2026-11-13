package kz.soundworld.ar;

/**
 * Streaming 48 kHz -> 16 kHz mono resampler for genuine microphone PCM.
 * 63-tap Blackman-windowed low-pass FIR, followed by exact 3:1 decimation.
 * Preserve filter history across Android AudioRecord.read() boundaries.
 *
 * Not a sound generator. Never manufactures activity / audio classifications.
 */
public final class SoundWorldMicResampler {
  private static final int TAPS = 63;
  private static final int RATIO = 3;
  private static final double CUTOFF = 0.145; // 6960 Hz from a 48k input; below 8k Nyquist
  private final float[] taps = new float[TAPS];
  private final short[] history = new short[TAPS];
  private int cursor = 0;
  private long received = 0;

  public SoundWorldMicResampler() {
    double sum=0;
    for (int i=0; i<TAPS; i++) {
      double n=i-(TAPS-1)/2.0;
      double sinc = n == 0 ? 2*CUTOFF : Math.sin(2*Math.PI*CUTOFF*n)/(Math.PI*n);
      double window=0.42-0.5*Math.cos(2*Math.PI*i/(TAPS-1))+
        0.08*Math.cos(4*Math.PI*i/(TAPS-1));
      taps[i]=(float)(sinc*window);
      sum+=taps[i];
    }
    for(int i=0;i<TAPS;i++) taps[i]/=(float)sum;
  }

  /**
   * One 16kHz [-1,1] sample every three actual 48kHz input samples.
   * Float.NaN means the FIR has not yet produced a new output sample.
   */
  public float push(short actualPcm) {
    history[cursor]=actualPcm;
    cursor=(cursor+1)%TAPS;
    if (++received % RATIO != 0) return Float.NaN;
    float filtered=0;
    int index=cursor;
    for (int k=0; k<TAPS; k++) {
      index=(index==0?TAPS-1:index-1);
      filtered+=taps[k]*history[index];
    }
    return Math.max(-1f,Math.min(1f,filtered/32768f));
  }
}
