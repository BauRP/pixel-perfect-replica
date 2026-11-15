import {describe,it,expect} from "vitest";
import {historyIsEmpty,HISTORY_DISK_SCAN_TIMEOUT_MS} from "../lib/sw/history-loading";

describe("real WAV history loading state",()=>{
  it("never reports empty while native scans the disk or returns an error",()=>{
    expect(historyIsEmpty("loading",0)).toBe(false);
    expect(historyIsEmpty("error",0)).toBe(false);
    expect(historyIsEmpty("ready",0)).toBe(true);
    expect(historyIsEmpty("ready",2)).toBe(false);
  });
  it("provides enough time for serial SHA-256 scans of saved WAVs",()=>{
    expect(HISTORY_DISK_SCAN_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(HISTORY_DISK_SCAN_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});
