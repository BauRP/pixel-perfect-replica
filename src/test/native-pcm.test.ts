import {describe,it,expect} from "vitest";
import {validatePcmChunk} from "../lib/sw/native-pcm";
describe("real PCM output buffer validation",()=>{
  it("only accepts 48kHz stereo 16-bit aligned frames",()=>{
    expect(validatePcmChunk(new Uint8Array(4))).toBe(true);
    expect(validatePcmChunk(new Uint8Array(0))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(3))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(192004))).toBe(false);
    expect(validatePcmChunk(new Uint8Array(192000))).toBe(true);
  });
});
