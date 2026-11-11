import { describe, it, expect } from "vitest";
import { verifiedWavProgress, wavTimestamp } from "../lib/sw/wav-progress";
describe("actual Android WAV playback position",()=>{
  it("uses only valid measured positions",()=>{
    expect(verifiedWavProgress(30000,120000)).toEqual({positionMs:30000,durationMs:120000,percent:25});
    expect(verifiedWavProgress(500000,120000)?.positionMs).toBe(120000);
    expect(verifiedWavProgress(0,0)).toBeNull();
    expect(verifiedWavProgress(Number.NaN,5000)).toBeNull();
    expect(verifiedWavProgress(100,Number.POSITIVE_INFINITY)).toBeNull();
    expect(verifiedWavProgress(-1,5000)).toBeNull();
    expect(verifiedWavProgress(100,999999)).toBeNull();
  });
  it("formats durations without estimating clock progress",()=>{
    expect(wavTimestamp(0)).toBe("0:00");
    expect(wavTimestamp(61000)).toBe("1:01");
    expect(wavTimestamp(120499)).toBe("2:00");
  });
});