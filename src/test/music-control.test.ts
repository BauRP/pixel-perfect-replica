import { describe, it, expect } from "vitest";
import { MusicControlPlanner } from "../lib/sw/music-control";
import { DEFAULT_SETTINGS } from "../lib/sw/settings";
import { INITIAL_POLICY, transitionAudioPolicy } from "../lib/sw/session-policy";

describe("real-world signals to future music directives", () => {
  it("requires confirmed environment, never prompts full regeneration for single transient", () => {
    const p = new MusicControlPlanner();
    expect(p.observeAmbient({atmosphere:"rain",confidence:.2,timestamp:1000},DEFAULT_SETTINGS)).toBe(false);
    expect(p.plan(DEFAULT_SETTINGS,1000).regenerate).toBe(false);
    expect(p.observeAmbient({atmosphere:"rain",confidence:.9,timestamp:2000},DEFAULT_SETTINGS)).toBe(true);
    expect(p.plan(DEFAULT_SETTINGS,2000).regenerate).toBe(true);
    expect(p.plan(DEFAULT_SETTINGS,2001).regenerate).toBe(false);
    expect(p.observeAmbient({atmosphere:"traffic",confidence:.9,timestamp:3000},DEFAULT_SETTINGS)).toBe(false);
    expect(p.plan(DEFAULT_SETTINGS,3000).atmosphere).toBe("rain");
    expect(p.observeAmbient({atmosphere:"traffic",confidence:.9,timestamp:25000},DEFAULT_SETTINGS)).toBe(true);
  });
  it("weak mode requires stronger confidence and longer gap between scene changes",()=>{
    const p=new MusicControlPlanner();
    const weak={...DEFAULT_SETTINGS,environmentReaction:"weak" as const};
    expect(p.observeAmbient({atmosphere:"rain",confidence:.7,timestamp:1000},weak)).toBe(false);
    expect(p.observeAmbient({atmosphere:"rain",confidence:.85,timestamp:2000},weak)).toBe(true);
    expect(p.observeAmbient({atmosphere:"traffic",confidence:.9,timestamp:30000},weak)).toBe(false);
    expect(p.observeAmbient({atmosphere:"traffic",confidence:.9,timestamp:38000},weak)).toBe(true);
    const fast=new MusicControlPlanner(),strong={...DEFAULT_SETTINGS,environmentReaction:"strong" as const};
    expect(fast.observeAmbient({atmosphere:"rain",confidence:.6,timestamp:1000},strong)).toBe(true);
    expect(fast.observeAmbient({atmosphere:"traffic",confidence:.6,timestamp:13500},strong)).toBe(true);
  });
  it("honors slow composition tempo when walking or running fast", () => {
    const p = new MusicControlPlanner();
    expect(p.observePace({bpm:180,confidence:.9,timestamp:1000})).toBe(true);
    const x=p.plan({...DEFAULT_SETTINGS,speed:-3},1000);
    expect(x.tempoBpm).toBe(64);
    expect(x.stepPulseBpm).toBe(90);
    expect(x.gainCeiling).toBe(.85);
  });
  it("does not infer rest from missing steps; ignores stale pace", () => {
    const p=new MusicControlPlanner();
    expect(p.plan(DEFAULT_SETTINGS,1000).activity).toBe("unknown");
    expect(p.observePace({bpm:105,confidence:.8,timestamp:1000})).toBe(true);
    expect(p.plan(DEFAULT_SETTINGS,8000).stepPulseBpm).toBeNull();
    expect(p.plan(DEFAULT_SETTINGS,8000).activity).toBe("unknown");
  });
  it("locks atmosphere while allowing step percussion instructions", () => {
    const p=new MusicControlPlanner();
    p.setAtmosphereLock(true);
    expect(p.observeAmbient({atmosphere:"rain",confidence:1,timestamp:1000},DEFAULT_SETTINGS)).toBe(false);
    p.observePace({bpm:110,confidence:.8,timestamp:1000});
    const s={...DEFAULT_SETTINGS,directorRules:DEFAULT_SETTINGS.directorRules.map(x=>({...x,enabled:x.id==="steps-drums"}))};
    const x=p.plan(s,1000);
    expect(x.atmosphere).toBe("unknown");
    expect(x.directorEffects).toContain("accent-step-percussion");
    expect(x.regenerate).toBe(false);
  });
  it("music-only mode does not capture or use environment events in control plan", () => {
    const p=new MusicControlPlanner();
    p.observeAmbient({atmosphere:"rain",confidence:1,timestamp:2000},DEFAULT_SETTINGS);
    const x=p.plan({...DEFAULT_SETTINGS,musicOnlyMode:true,useOfEnvironmentSounds:"mixProcessed"},2000);
    expect(x.atmosphere).toBe("unknown");
    expect(x.allowProcessedAmbientAudio).toBe(false);
    expect(x.regenerate).toBe(false);
    expect(x.stepPulseBpm).toBeNull();
  });
  it("Studio quiet-sparse director rule uses confirmed Silence, not absence of steps",()=>{
    const planner=new MusicControlPlanner();
    const s={...DEFAULT_SETTINGS,directorRules:DEFAULT_SETTINGS.directorRules.map(r=>({
      ...r,enabled:r.id==="quiet-sparse",
    }))};
    expect(planner.plan(s,5000).directorEffects).not.toContain("sparser-arrangement");
    expect(planner.observeAmbient({atmosphere:"quiet",confidence:.9,timestamp:6000},s)).toBe(true);
    const plan=planner.plan(s,6000);
    expect(plan.atmosphere).toBe("quiet");
    expect(plan.directorEffects).toContain("sparser-arrangement");
    expect(plan.regenerate).toBe(true);
    expect(planner.plan({...s,musicOnlyMode:true},6001).directorEffects).not.toContain("sparser-arrangement");
    const disabled={...s,directorRules:s.directorRules.map(x=>({...x,enabled:false}))};
    expect(planner.plan(disabled,6002).directorEffects).not.toContain("sparser-arrangement");
  });
  it("weak steps still receive quiet accents rather than being disabled",()=>{
    const p=new MusicControlPlanner();p.observePace({bpm:90,confidence:.8,timestamp:1000});
    const weak=p.plan({...DEFAULT_SETTINGS,stepsInfluence:"weak"},1000);
    const active=p.plan({...DEFAULT_SETTINGS,stepsInfluence:"active"},1000);
    expect(weak.stepPulseBpm).toBe(90);
    expect(weak.stepAccentStrength).toBeLessThan(active.stepAccentStrength);
  });
});
describe("audio interruption safety rules",()=>{
  it("calls never autostart a session the user had stopped",()=>{
    const s=transitionAudioPolicy(INITIAL_POLICY,"call-start",true).state;
    expect(transitionAudioPolicy(s,"call-end",true).action).toBe("none");
  });
  it("call resumes only if previously playing and allowed",()=>{
    const a=transitionAudioPolicy(INITIAL_POLICY,"user-play",true);
    const b=transitionAudioPolicy(a.state,"call-start",true);
    expect(b.action).toBe("pause");
    expect(transitionAudioPolicy(b.state,"call-end",false).action).toBe("none");
    expect(transitionAudioPolicy(b.state,"call-end",true).action).toBe("play");
  });
  it("manual pause during a call suppresses auto resume",()=>{
    const a=transitionAudioPolicy(INITIAL_POLICY,"user-play",true).state;
    const b=transitionAudioPolicy(a,"call-start",true).state;
    const c=transitionAudioPolicy(b,"user-pause",true).state;
    expect(transitionAudioPolicy(c,"call-end",true).action).toBe("none");
  });
  it("headset unplug does not silently switch to speaker",()=>{
    const a=transitionAudioPolicy(INITIAL_POLICY,"user-play",true).state;
    const b=transitionAudioPolicy(a,"headset-disconnected",true);
    expect(b.action).toBe("pause");
    expect(transitionAudioPolicy(b.state,"audio-focus-gain",true).action).toBe("none");
  });
  it("focus resume requires preceding playback",()=>{
    expect(transitionAudioPolicy(INITIAL_POLICY,"audio-focus-gain",true).action).toBe("none");
    const a=transitionAudioPolicy(INITIAL_POLICY,"user-play",true).state;
    const b=transitionAudioPolicy(a,"audio-focus-loss",true);
    expect(b.action).toBe("pause");
    expect(transitionAudioPolicy(b.state,"audio-focus-gain",true).action).toBe("play");
  });
});
