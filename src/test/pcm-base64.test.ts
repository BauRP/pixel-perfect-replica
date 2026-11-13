import { describe, expect, it } from "vitest";
import { pcmToBase64 } from "../lib/sw/pcm-base64";

describe("Android PCM base64 bridge", () => {
  it("preserves every byte in a real stereo PCM frame", () => {
    const pcm = Uint8Array.from([0, 255, 0, 128, 1, 127, 254, 18]);
    expect(Array.from(atob(pcmToBase64(pcm)), c => c.charCodeAt(0))).toEqual(Array.from(pcm));
  });

  it("crosses conversion chunk boundaries without corruption", () => {
    const pcm = new Uint8Array(192000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 37 + 19) & 255;
    const encoded = pcmToBase64(pcm);
    const decoded = atob(encoded);
    expect(decoded.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) expect(decoded.charCodeAt(i)).toBe(pcm[i]);
  });

  it("does not change or detach the original input", () => {
    const pcm = new Uint8Array(48000);
    pcm.fill(205);
    pcmToBase64(pcm);
    expect(pcm[0]).toBe(205);
    expect(pcm[pcm.length - 1]).toBe(205);
  });
});
