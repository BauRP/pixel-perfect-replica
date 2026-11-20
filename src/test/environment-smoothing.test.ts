import {describe,it,expect} from "vitest";
import { AmbientStabilizer, StepPaceEstimator, classifyAtmosphere } from "../lib/sw/environment-smoothing";
describe("real event filtering (no simulated detections)",()=>{
  it("maps only supported YAMNet classes",()=>{
    expect(classifyAtmosphere("Rain")).toBe("rain");
    expect(classifyAtmosphere("Vehicle")).toBe("traffic");
    expect(classifyAtmosphere("Speech")).toBe("unknown");
    expect(classifyAtmosphere("Silence")).toBe("quiet");
    expect(classifyAtmosphere("Silence and conversation")).toBe("unknown");
    // These were real false matches caused by substring-based classification.
    expect(classifyAtmosphere("Train")).toBe("traffic");
    expect(classifyAtmosphere("Railroad")).toBe("traffic");
    expect(classifyAtmosphere("Train horn")).toBe("traffic");
    expect(classifyAtmosphere("Brain")).toBe("unknown");
    expect(classifyAtmosphere("Window")).toBe("unknown");
    expect(classifyAtmosphere("Carpenter")).toBe("unknown");
    expect(classifyAtmosphere("Rain on surface")).toBe("rain");
    expect(classifyAtmosphere("Bird vocalization, bird call, bird song")).toBe("nature");
    expect(classifyAtmosphere(undefined as unknown as string)).toBe("unknown");
  });
  it("quiet needs two independent real YAMNet Silence predictions",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Silence",confidence:.8,timestamp:1000})).toBeNull();
    expect(s.update({label:"Silence",confidence:.8,timestamp:1300})).toBeNull();
    expect(s.update({label:"Silence",confidence:.8,timestamp:2100})?.atmosphere).toBe("quiet");
  });
  it("rejects single events and uncertain sounds",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.7,timestamp:1000})).toBeNull();
    expect(s.update({label:"Car horn",confidence:.15,timestamp:1200})).toBeNull();
    expect(s.stable).toBe("unknown");
    expect(s.update({label:"Rain",confidence:5,timestamp:1500})).toBeNull();
    expect(s.stable).toBe("unknown");
  });
  it("ignores secondary speech/low score without resetting real rain evidence",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.8,timestamp:1000})).toBeNull();
    expect(s.update({label:"Speech",confidence:.7,timestamp:1000})).toBeNull();
    expect(s.update({label:"Vehicle",confidence:.2,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.8,timestamp:2000})?.atmosphere).toBe("rain");
  });
  it("never treats multiple labels in the same analysis window as independent evidence",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1100})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:2100})?.atmosphere).toBe("rain");
  });
  it("keeps uninterrupted real rain fresh using new confirmed windows, not duplicate labels",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:2000})?.atmosphere).toBe("rain");
    expect(s.update({label:"Rain",confidence:.9,timestamp:2000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:2700})?.atmosphere).toBe("rain");
    expect(s.update({label:"Rain",confidence:.9,timestamp:2800})).toBeNull();
  });
  it("confirms consecutive matching classifications, respects hold time",()=>{
    const s=new AmbientStabilizer(.5,2,1500);
    expect(s.update({label:"Rain",confidence:.7,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.8,timestamp:2000})?.atmosphere).toBe("rain");
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:3100})).toBeNull();
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:3600})).toBeNull();
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:4200})?.atmosphere).toBe("traffic");
  });
  it("confirms two real YAMNet windows despite battery throttling, never one",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:9000})?.atmosphere).toBe("rain");
    const afterGap=new AmbientStabilizer();
    expect(afterGap.update({label:"Traffic",confidence:.9,timestamp:1000})).toBeNull();
    expect(afterGap.update({label:"Traffic",confidence:.9,timestamp:15000})).toBeNull();
    expect(afterGap.update({label:"Traffic",confidence:.9,timestamp:22000})?.atmosphere).toBe("traffic");
  });
  it("ignores delayed YAMNet labels rather than reverting a confirmed scene",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.9,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.9,timestamp:2000})?.atmosphere).toBe("rain");
    expect(s.update({label:"Traffic",confidence:.9,timestamp:1500})).toBeNull();
    expect(s.update({label:"Traffic",confidence:.9,timestamp:2700})).toBeNull();
    expect(s.update({label:"Traffic",confidence:.9,timestamp:3800})?.atmosphere).toBe("traffic");
    expect(s.update({label:"Rain",confidence:.95,timestamp:3000})).toBeNull();
    expect(s.stable).toBe("traffic");
  });
  it("does not lose a valid step cadence after a delayed sensor callback",()=>{
    const s=new StepPaceEstimator();
    [1000,1600,2200,2800].forEach(t=>s.ingest(t));
    expect(s.ingest(3400).activity).toBe("walking");
    // Old step, duplicate and near-duplicate are not new independent steps.
    expect(s.ingest(1800).activity).toBe("unknown");
    expect(s.ingest(3400).activity).toBe("unknown");
    expect(s.ingest(3500).activity).toBe("unknown"); // rejected near-duplicate <200 ms
    // Returning "unknown" for rejected events prevents a stale hardware
    // callback from refreshing the player with a fictitious new step.
    expect(s.ingest(3800).activity).toBe("walking");
    expect(s.ingest(13000).activity).toBe("unknown");
  });
  it("does not infer rest from absent steps",()=>{
    const s=new StepPaceEstimator();
    expect(s.ingest(1000).activity).toBe("unknown");
    expect(s.ingest(1800).activity).toBe("unknown");
    expect(s.ingest(2600).activity).toBe("unknown");
    expect(s.ingest(3400).activity).toBe("walking");
    s.reset();
    expect(s.ingest(9000).activity).toBe("unknown");
  });
  it("recognizes genuine high-cadence runner steps around 240ms apart",()=>{
    const s=new StepPaceEstimator();
    [1000,1240,1480,1720,1960,2200].forEach(t=>s.ingest(t));
    const p=s.ingest(2440);
    expect(p.activity).toBe("running");
    expect(p.bpm).toBe(250);
    expect(p.confidence).toBeGreaterThan(.55);
  });
  it("recognizes faster step tempo without accelerating already recorded audio",()=>{
    const s=new StepPaceEstimator();
    [1000,1350,1700,2050,2400].forEach(t=>s.ingest(t));
    const p=s.ingest(2750); expect(p.activity).toBe("running");expect(p.bpm).toBeGreaterThan(145);
  });
});
