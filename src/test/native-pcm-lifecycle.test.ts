import {describe,it,expect,vi} from "vitest";

// Mock only the Android bridge: verify ordering, not a fabricated audio model.
const driver=vi.hoisted(()=>({
  events: [] as string[],
  releaseStart: null as null|(()=>void),
  receipts: [] as Array<()=>void>,
  packetValues: [] as string[],
  holdPackets: false,
  hangStart: false,
  hangStatus: false,
}));
vi.mock("@capacitor/core",()=>({
  Capacitor:{getPlatform:()=>"android"},
  registerPlugin:()=>({
    start:()=>new Promise<{preparing:boolean}>(resolve=>{
      driver.events.push("start");
      driver.releaseStart=()=>resolve({preparing:true});
      if(driver.hangStart)driver.releaseStart=null;
    }),
    status:()=>driver.hangStatus?new Promise<never>(()=>{}):
      Promise.resolve({readyForPcm:true,sessionId:91,lastAudioError:""}),
    appendPcm:({base64}:{base64:string})=>{
      driver.packetValues.push(base64);
      if(!driver.holdPackets)return Promise.resolve({queued:true});
      return new Promise<{queued:boolean}>(resolve=>{
        driver.receipts.push(()=>resolve({queued:true}));
      });
    },
    stop:async()=>{driver.events.push("stop");return {requested:true};},
    pause:async()=>{driver.events.push("pause");return {audible:false};},
  }),
}));
import {requestNativeAudioSink,stopNativeAudioSink,pauseNativeAudioSink,appendRealPcm} from "../lib/sw/native-pcm";

// The real bridge serializes lifecycle calls across multiple microtasks.
// Wait until the native mock actually receives START, not a fixed one-tick guess.
async function waitForNativeStart(count:number):Promise<void>{
  for(let tick=0;tick<80 && driver.events.filter(x=>x==="start").length<count;tick++){
    await Promise.resolve();
  }
  expect(driver.events.filter(x=>x==="start").length).toBe(count);
}

describe("Android real PCM lifecycle ordering",()=>{
  it("STOP is not trapped behind an unresponsive Android start callback",async()=>{
    vi.useFakeTimers();
    try{
      driver.events.length=0;
      driver.hangStart=true;
      const starting=requestNativeAudioSink();
      for(let i=0;i<6;i++)await Promise.resolve();
      const stopping=stopNativeAudioSink();
      await vi.advanceTimersByTimeAsync(4000);
      expect((await starting).ok).toBe(false);
      await stopping;
      expect(driver.events).toContain("stop");
    }finally{driver.hangStart=false;vi.useRealTimers();}
  });
  it("STOP also recovers from a never-resolved status callback",async()=>{
    vi.useFakeTimers();
    try{
      driver.events.length=0;
      driver.hangStatus=true;
      const starting=requestNativeAudioSink();
      for(let i=0;i<6;i++)await Promise.resolve();
      driver.releaseStart?.();
      for(let i=0;i<6;i++)await Promise.resolve();
      const stopping=stopNativeAudioSink();
      await vi.advanceTimersByTimeAsync(2500);
      expect((await starting).ok).toBe(false);
      await stopping;
      expect(driver.events).toContain("stop");
    }finally{driver.hangStatus=false;vi.useRealTimers();}
  });
  it("holds concurrent genuine PCM packets in order, copying each payload",async()=>{
    driver.events.length=0;driver.packetValues.length=0;
    driver.receipts.length=0;driver.holdPackets=true;
    const start=requestNativeAudioSink();
    await waitForNativeStart(1);
    driver.releaseStart?.();
    expect((await start).ok).toBe(true);
    const firstBytes=new Uint8Array([1,0,1,0]);
    const first=appendRealPcm(firstBytes);
    firstBytes[0]=9;
    const second=appendRealPcm(new Uint8Array([2,0,2,0]));
    await Promise.resolve();await Promise.resolve();
    expect(driver.packetValues).toHaveLength(1);
    driver.receipts.shift()?.();
    expect((await first).ok).toBe(true);
    // Drain the second native packet only after the first acknowledgement.
    for(let tick=0;tick<8 && driver.receipts.length===0;tick++) await Promise.resolve();
    expect(driver.packetValues).toHaveLength(2);
    driver.receipts.shift()?.();
    expect((await second).ok).toBe(true);
    expect(driver.packetValues[0]).not.toBe(driver.packetValues[1]);
    driver.holdPackets=false;
    await stopNativeAudioSink();
  });
  it("refuses excessive concurrent PCM without allocating an unbounded queue",async()=>{
    driver.packetValues.length=0;driver.receipts.length=0;driver.holdPackets=true;
    const start=requestNativeAudioSink();await waitForNativeStart(1);driver.releaseStart?.();
    expect((await start).ok).toBe(true);
    const tasks=Array.from({length:8},()=>appendRealPcm(new Uint8Array(4)));
    const ninth=await appendRealPcm(new Uint8Array(4));
    expect(ninth.ok).toBe(false);
    for(let i=0;i<8;i++){
      for(let tick=0;tick<12 && driver.receipts.length===0;tick++)await Promise.resolve();
      driver.receipts.shift()?.();
    }
    expect((await Promise.all(tasks)).every(x=>x.ok)).toBe(true);
    driver.holdPackets=false;await stopNativeAudioSink();
  });
  it("a late START cannot resurrect audio after STOP",async()=>{
    driver.events.length=0;
    const starting=requestNativeAudioSink();
    await waitForNativeStart(1);
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
    await waitForNativeStart(1);
    const paused=pauseNativeAudioSink();
    const next=requestNativeAudioSink();
    driver.releaseStart?.();
    expect((await starting).ok).toBe(false);
    await paused;
    // The second START happens strictly after native PAUSE.
    await waitForNativeStart(2);
    expect(driver.events).toEqual(["start","pause","start"]);
    driver.releaseStart?.();
    expect((await next).ok).toBe(true);
    await stopNativeAudioSink();
    expect(driver.events.at(-1)).toBe("stop");
  });
});
