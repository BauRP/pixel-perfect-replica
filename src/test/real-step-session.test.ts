import {describe,expect,it} from "vitest";
import {RealStepSession} from "../lib/sw/real-step-session";

describe("Real Android step counter in diagnostics",()=>{
  it("counts only individual native detector events after the user starts a test",()=>{
    const s=new RealStepSession();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:10_100},10_150)).toBeNull();
    s.start(10_000);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:9_999},10_150)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_COUNTER",timestamp:10_050},10_150)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:10_100},10_150)?.count).toBe(1);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:10_100},10_160)).toBeNull();
    // A second genuinely distinct physical step must not be lost to a
    // fixed "debounce" rule when the user runs at a quick pace.
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:10_240},10_300)?.count).toBe(2);
    expect(s.total).toBe(2);
  });
  it("rejects delayed, out-of-order, impossible future and invalid readings",()=>{
    const s=new RealStepSession();s.start(100_000);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:100_100},100_200)?.count).toBe(1);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:100_020},100_300)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:110_000},120_001)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:150_000},120_000)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:NaN},120_000)).toBeNull();
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:120_000.5},120_010)).toBeNull();
    expect(s.total).toBe(1);
  });
  it("freezes on stop, resets for a new test, never guesses steps from silence",()=>{
    const s=new RealStepSession();s.start(20_000);
    expect(s.total).toBe(0);
    s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:20_500},20_700);
    s.stop();
    expect(s.active).toBe(false);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:21_000},21_100)).toBeNull();
    expect(s.total).toBe(1);
    s.start(30_000);
    expect(s.total).toBe(0);
    expect(s.ingest({sensor:"TYPE_STEP_DETECTOR",timestamp:20_700},30_000)).toBeNull();
    expect(s.total).toBe(0);
  });
});
