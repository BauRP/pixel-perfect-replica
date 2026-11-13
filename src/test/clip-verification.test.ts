import { describe, expect, it } from "vitest";
import { confirmedFinishedClip } from "../lib/sw/clip-verification";
const valid = {
  id: "4f4f4f4f-1234-5678-1234-123456789abc",
  createdAt: 1700000000000,
  durationSec: 60,
  genreIds: ["g01-s01"],
  mood: 0,
  speed: 0,
  favorite: false,
};
describe("native WAV completion receipt", () => {
  it("requires a real matching ID and 60-120 second duration", () => {
    expect(confirmedFinishedClip(valid, valid.id)).toBe(true);
    expect(confirmedFinishedClip({...valid,durationSec:120}, valid.id)).toBe(true);
    expect(confirmedFinishedClip({...valid,durationSec:59.99}, valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,durationSec:120.01}, valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,durationSec:NaN}, valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,durationSec:Infinity}, valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,id:"another"}, valid.id)).toBe(false);
  });
  it("never accepts missing or corrupt metadata as finished audio", () => {
    expect(confirmedFinishedClip(undefined,valid.id)).toBe(false);
    expect(confirmedFinishedClip({},valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,createdAt:0},valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,genreIds:null},valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,genreIds:[3]},valid.id)).toBe(false);
    expect(confirmedFinishedClip({...valid,mood:NaN},valid.id)).toBe(false);
  });
});
