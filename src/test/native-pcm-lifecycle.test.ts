import {describe,it,expect,vi} from "vitest";

// Mock only the Android bridge: verify ordering, not a fabricated audio model.
const driver=vi.hoisted(()=>({
  events: [] as string[],
  releaseStart: null as null|(()=>void),
}));
vi.mock("@capacitor/core",()=>({
  Capacitor:{getPlatform:()=>"android"},
  registerPlugin:()=>({
    start:()=>new Promise<{preparing:boolean}>(resolve=>{
      driver.events.push("start");
      driver.releaseStart=()=>resolve({preparing:true});
    }),
    status:async()=>({readyForPcm:true,sessionId:91,lastAudioError:""}),
    stop:async()=>{driver.events.push("stop");return {requested:true};},
    pause:async()=>{driver.events.push("pause");return {audible:false};},
  }),
}));
import {requestNativeAudioSink,stopNativeAudioSink,pauseNativeAudioSink} from "../lib/sw/native-pcm";

describe("Android real PCM lifecycle ordering",()=>{
  it("a late START cannot resurrect audio after STOP",async()=>{
    driver.events.length=0;
    const starting=requestNativeAudioSink();
    await Promise.resolve();
    expect(driver.events).toEqual(["start"]);
    const stopping=stopNativeAudioSink();
    expect(driver.events).toEqual(["start"]);
    driver.releaseStart?.();
    const result=await starting;
    expect(result.ok).toBe(false);
    await stopping;
    expect(driver.events).toEqual(["start","stop"]);
  });
  it("a late START cannot overtake PAUSE or a new START",async()=>{
    driver.events.length=0;
    const starting=requestNativeAudioSink();
    await Promise.resolve();
    const paused=pauseNativeAudioSink();
    const next=requestNativeAudioSink();
    driver.releaseStart?.();
    expect((await starting).ok).toBe(false);
    await paused;
    // The second START happens strictly after native PAUSE.
    expect(driver.events).toEqual(["start","pause","start"]);
    driver.releaseStart?.();
    expect((await next).ok).toBe(true);
    await stopNativeAudioSink();
    expect(driver.events.at(-1)).toBe("stop");
  });
});
