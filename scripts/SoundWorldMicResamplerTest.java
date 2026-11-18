package kz.soundworld.ar;

public final class SoundWorldMicResamplerTest {
  private static void ok(String label, boolean condition) {
    if(!condition) throw new AssertionError(label);
  }
  private static float[] generate(double frequency, int length) {
    float[] output=new float[length/3];
    SoundWorldMicResampler r=new SoundWorldMicResampler();
    int at=0;
    for(int n=0;n<length;n++) {
      short sample=(short)Math.round(Math.sin(2*Math.PI*frequency*n/48000)*20000);
      float v=r.push(sample);
      if(!Float.isNaN(v)) output[at++]=v;
    }
    ok("exact 3:1 sample count",at==output.length);
    return output;
  }
  private static double rms(float[] values) {
    double sum=0;int count=0;
    // Ignore the 31-sample group delay and initial zero-padded filter.
    for(int i=128;i<values.length;i++) {sum+=values[i]*values[i];count++;}
    return Math.sqrt(sum/count);
  }
  public static void main(String[] args) {
    SoundWorldMicResampler freshAfterSwitch = new SoundWorldMicResampler();
    for (int i=0;i<500;i++) freshAfterSwitch.push((short)14000);
    freshAfterSwitch.reset();
    SoundWorldMicResampler pristine = new SoundWorldMicResampler();
    for (int i=0;i<180;i++) {
      short sample=(short)(i%2==0?7000:-7000);
      float actual=freshAfterSwitch.push(sample);
      float expected=pristine.push(sample);
      if(Float.isNaN(actual) != Float.isNaN(expected) ||
         (!Float.isNaN(actual) && Math.abs(actual-expected)>0.00001f))
        throw new AssertionError("Microphone route reset must clear FIR history");
    }
    float[] pass=generate(1000,48000);
    float[] stop=generate(12000,48000);
    double passRms=rms(pass),stopRms=rms(stop);
    ok("preserves audio 1kHz",passRms>0.35 && passRms<0.48);
    ok("rejects alias 12kHz",stopRms<passRms*0.04);
    ok("waiting two samples is not output",Float.isNaN(new SoundWorldMicResampler().push((short)0)));
    SoundWorldMicResampler r=new SoundWorldMicResampler();
    int produced=0;
    for(int chunk=0;chunk<480;chunk++) {
      for(int i=0;i<100;i++) if(!Float.isNaN(r.push((short)1000))) produced++;
    }
    ok("preserves packet boundaries",produced==16000);
    System.out.println("PASS: authentic 48k mic PCM resampled to YAMNet 16k without aliasing");
  }
}
