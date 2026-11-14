import {describe,it,expect} from "vitest";
import {validatePcmChunk,positivePcmAcknowledgment,confirmedAudioStop} from "../lib/sw/native-pcm";
describe("real PCM output buffer validation",()=>{
  it("accepts only a positive native PCM queue confirmation",()=>{
    expect(positivePcmAcknowledgment({queued:true})).toBe(true);
    expect(positivePcmAcknowledgment({queued:false})).toBe(false);
    expect(positivePcmAcknowledgment({})).toBe(false);
    expect(positivePcmAcknowledgment(null)).toBe(false);
    expect(positivePcmAcknowledgment(undefined)).toBe(false);
  });
  it("requires Android confirmation when stopping a generated audio service",()=>{
    expect(confirmedAudioStop({requested:true})).toBe(true);
    expect(confirmedAudioStop({requested:false})).toBe(false);
    expect(confirmedAudioStop({})).toBe(false);
    expect(confirmedAudioStop(null)).toBe(false);
  });
  it("only accepts 48kHz stereo 16-bit aligned frames",()=>{
    expect(validatePcmChunk(new Uint8Array(4))).toBe(true);
    expect(validatePcmChunk(new Uint8Array(0))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(3))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(192004))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(192000))).toBe(true);
  });
});
