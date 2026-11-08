import {describe,it,expect} from "vitest";
import { AmbientStabilizer, StepPaceEstimator, classifyAtmosphere } from "../lib/sw/environment-smoothing";
describe("real event filtering (no simulated detections)",()=>{
  it("maps only supported YAMNet classes",()=>{
    expect(classifyAtmosphere("Rain")).toBe("rain");
    expect(classifyAtmosphere("Vehicle")).toBe("traffic");
    expect(classifyAtmosphere("Speech")).toBe("unknown");
  });
  it("rejects single events and uncertain sounds",()=>{
    const s=new AmbientStabilizer();
    expect(s.update({label:"Rain",confidence:.7,timestamp:1000})).toBeNull();
    expect(s.update({label:"Car horn",confidence:.15,timestamp:1200})).toBeNull();
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
  it("confirms consecutive matching classifications, respects hold time",()=>{
    const s=new AmbientStabilizer(.5,2,1500);
    expect(s.update({label:"Rain",confidence:.7,timestamp:1000})).toBeNull();
    expect(s.update({label:"Rain",confidence:.8,timestamp:2000})?.atmosphere).toBe("rain");
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:3100})).toBeNull();
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:3600})).toBeNull();
    expect(s.update({label:"Vehicle",confidence:.8,timestamp:4200})?.atmosphere).toBe("traffic");
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
  it("recognizes faster step tempo without accelerating already recorded audio",()=>{
    const s=new StepPaceEstimator();
    [1000,1350,1700,2050,2400].forEach(t=>s.ingest(t));
    const p=s.ingest(2750); expect(p.activity).toBe("running");expect(p.bpm).toBeGreaterThan(145);
  });
});
