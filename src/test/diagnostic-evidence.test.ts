import { describe, expect, it } from "vitest";
import { AmbientStabilizer, StepPaceEstimator } from "../lib/sw/environment-smoothing";
import { MusicControlPlanner } from "../lib/sw/music-control";
import { BirdEvidenceGate } from "../lib/sw/director-live-preview";
import { DEFAULT_SETTINGS } from "../lib/sw/settings";
import { resetDiagnosticEvidence } from "../lib/sw/diagnostic-evidence";

describe("new Android diagnostics session",()=>{
  it("clears stale audio, pace and bird evidence between sessions",()=>{
    const estimator=new StepPaceEstimator();
    const stabilizer=new AmbientStabilizer();
    const planner=new MusicControlPlanner();
    const birds=new BirdEvidenceGate();
    estimator.ingest(1000);estimator.ingest(1600);estimator.ingest(2200);estimator.ingest(2800);
    expect(estimator.ingest(3400).activity).toBe("walking");
    stabilizer.update({label:"Rain",confidence:.9,timestamp:1000});
    expect(stabilizer.update({label:"Rain",confidence:.9,timestamp:2000})?.atmosphere).toBe("rain");
    planner.observeAmbient({atmosphere:"rain",confidence:.9,timestamp:2000},DEFAULT_SETTINGS);
    planner.observePace({bpm:100,confidence:.8,timestamp:3400});
    birds.ingest("Bird",.9,1500);
    expect(planner.plan(DEFAULT_SETTINGS,3400).stepPulseBpm).toBe(100);
    resetDiagnosticEvidence({estimator,stabilizer,planner,birds});
    const next=planner.plan(DEFAULT_SETTINGS,3401);
    expect(next.atmosphere).toBe("unknown");
    expect(next.stepPulseBpm).toBeNull();
    expect(next.regenerate).toBe(false);
    expect(estimator.ingest(3500).activity).toBe("unknown");
    expect(stabilizer.update({label:"Rain",confidence:.9,timestamp:4000})).toBeNull();
    expect(birds.ingest("Bird",.9,4300)).toBe(false);
  });
  it("does not alter saved user settings when diagnostics resets",()=>{
    const s={...DEFAULT_SETTINGS,genreIds:["example"]};
    const planner=new MusicControlPlanner();
    resetDiagnosticEvidence({
      estimator:new StepPaceEstimator(),
      stabilizer:new AmbientStabilizer(),
      planner,
      birds:new BirdEvidenceGate(),
    });
    expect(s.musicOnlyMode).toBe(false);
    expect(s.onboardingCompleted).toBe(DEFAULT_SETTINGS.onboardingCompleted);
  });
});
