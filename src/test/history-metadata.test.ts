import { describe, expect, it } from "vitest";
import { normalizeHistoryClips } from "../lib/sw/history-metadata";

describe("WAV history accepts older recovered metadata safely", () => {
  it("shows verified legacy clips without inventing unknown dates, lengths or genres", () => {
    const result = normalizeHistoryClips([{ id: "clip-1", genreIds: null, createdAt: "invalid", durationSec: null, recoveredProtected: true }]);
    expect(result.skipped).toBe(0);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({
      id: "clip-1", createdAt: 0, durationSec: 0, genreIds: [], favorite: false, recoveredProtected: true,
    });
  });

  it("keeps known values intact and discards only unusable entries, never native files", () => {
    const result = normalizeHistoryClips([
      { id: "a", createdAt: 1000, durationSec: 120, genreIds: ["g01-01"], favorite: true, uri: "file:///a.wav" },
      null, { id: "" }, { id: "a" }, { id: "b", genreIds: ["g02-01", 7, null] },
    ]);
    expect(result.clips).toHaveLength(2);
    expect(result.skipped).toBe(3);
    expect(result.clips[0]).toMatchObject({ favorite: true, durationSec: 120, genreIds: ["g01-01"], uri: "file:///a.wav" });
    expect(result.clips[1]!.genreIds).toEqual(["g02-01"]);
    expect(normalizeHistoryClips(null)).toEqual({ clips: [], skipped: 1 });
  });

  it("never displays invalid timestamp or duration as genuine metadata", () => {
    const r = normalizeHistoryClips([{ id: "old", createdAt: Number.POSITIVE_INFINITY, durationSec: Number.NaN }]);
    expect(r.clips[0]!.createdAt).toBe(0);
    expect(r.clips[0]!.durationSec).toBe(0);
  });
});
