import { describe, expect, it } from "vitest";
import { normalizeHistoryClips } from "../lib/sw/history-metadata";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

describe("WAV history accepts older recovered metadata safely", () => {
  it("shows verified legacy clips without inventing unknown dates, lengths or genres", () => {
    const result = normalizeHistoryClips([{ id: ID1, genreIds: null, createdAt: "invalid", durationSec: null, recoveredProtected: true }]);
    expect(result.skipped).toBe(0);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({
      id: ID1, createdAt: 0, durationSec: 0, genreIds: [], favorite: false, recoveredProtected: true,
    });
  });

  it("keeps known values intact and discards only unusable entries, never native files", () => {
    const result = normalizeHistoryClips([
      { id: ID1, createdAt: 1000, durationSec: 120, genreIds: ["g01-01"], favorite: true, uri: "file:///a.wav" },
      null, { id: "" }, { id: ID1 }, { id: ID2, genreIds: ["g02-01", 7, null] },
    ]);
    expect(result.clips).toHaveLength(2);
    expect(result.skipped).toBe(3);
    expect(result.clips[0]).toMatchObject({ favorite: true, durationSec: 120, genreIds: ["g01-01"], uri: "file:///a.wav" });
    expect(result.clips[1]!.genreIds).toEqual(["g02-01"]);
    expect(normalizeHistoryClips(null)).toEqual({ clips: [], skipped: 1 });
  });

  it("never exposes a bogus native recording ID to Play, Favorite or Export", () => {
    const result = normalizeHistoryClips([
      { id: "non-empty-but-invalid", durationSec: 120 },
      { id: ID1, durationSec: 120 },
      { id: ID1.toUpperCase(), durationSec: 120 },
      { id: " " },
      { id: ID2, recoveredProtected: true },
    ]);
    expect(result.clips.map(c => c.id)).toEqual([ID1, ID2]);
    expect(result.skipped).toBe(3);
  });

  it("never displays invalid timestamp or duration as genuine metadata", () => {
    const r = normalizeHistoryClips([{ id: ID3, createdAt: Number.POSITIVE_INFINITY, durationSec: Number.NaN }]);
    expect(r.clips[0]!.createdAt).toBe(0);
    expect(r.clips[0]!.durationSec).toBe(0);
  });
});
