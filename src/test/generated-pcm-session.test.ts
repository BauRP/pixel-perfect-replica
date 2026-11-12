import { describe, it, expect, vi } from "vitest";
import { GeneratedPcmSession, PCM_SEGMENT_BYTES, PCM_MINIMUM_SAVE_BYTES, PCM_TRANSFER_BYTES } from "../lib/sw/generated-pcm-session";
import { DEFAULT_SETTINGS } from "../lib/sw/settings";
import type { ClipMeta, Result } from "../lib/sw/engine";

function rig() {
  const recorded:{id:string;length:number;finished:boolean;aborted:boolean}[]=[];
  const sent:number[]=[];
  let serial=0;
  let rejectNext=false;
  const sink={append:async(chunk:Uint8Array):Promise<Result<"queued">>=>{
    sent.push(chunk.length);
    return {ok:true,value:"queued"};
  }};
  const store={
    begin:async()=>{const id=String(++serial);recorded.push({id,length:0,finished:false,aborted:false});return {ok:true as const,value:id};},
    append:async(id:string,chunk:Uint8Array):Promise<Result<number>>=>{
      if(rejectNext){rejectNext=false;return {ok:false,code:"ERROR",message:"Диск заполнен"};}
      const x=recorded.find(x=>x.id===id)!;x.length+=chunk.length;
      return {ok:true,value:x.length};
    },
    finish:async(id:string)=>{recorded.find(x=>x.id===id)!.finished=true;return {ok:true as const,value:{id} as ClipMeta};},
    abort:async(id:string)=>{recorded.find(x=>x.id===id)!.aborted=true;},
  };
  return {recorded,sent,sink,store,failNext:()=>{rejectNext=true}};
}
describe("real PCM stream without fabricated audio",()=>{
  it("never begins audio storage until real data is submitted",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    expect(r.recorded).toHaveLength(0);
    expect((await p.stop()).ok).toBe(true);
    expect(r.recorded).toHaveLength(0);
  });
  it("writes exact PCM frames in order and finishes only an existing clip",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    const b=new Uint8Array(240);
    expect((await p.submit(b)).ok).toBe(true);
    expect((await p.submit(b)).ok).toBe(true);
    expect((await p.stop()).ok).toBe(true);
    expect(r.recorded).toEqual([{id:"1",length:480,finished:false,aborted:true}]);
    expect(p.status.completedClips).toBe(0);
  });
  it("copies reused source buffers and uses bounded packets",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    const chunk=new Uint8Array(PCM_TRANSFER_BYTES+4);
    const a=p.submit(chunk); chunk.fill(7);
    expect((await a).ok).toBe(true);
    expect(r.sent).toEqual([PCM_TRANSFER_BYTES,4]);
  });
  it("bounds pending producer buffers to prevent unlimited memory growth",async()=>{
    let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve});
    const r=rig();
    const slow={append:async(chunk:Uint8Array):Promise<Result<"queued">>=>{
      await gate;return r.sink.append(chunk);
    }};
    const p=new GeneratedPcmSession(slow,r.store,DEFAULT_SETTINGS,[]);
    const packets=Array.from({length:8},()=>p.submit(new Uint8Array(4)));
    const refused=await p.submit(new Uint8Array(4));
    expect(refused.ok).toBe(false);
    expect(p.status.pendingPackets).toBe(8);
    release();
    expect((await Promise.all(packets)).every(x=>x.ok)).toBe(true);
    expect(p.status.pendingPackets).toBe(0);
  });
  it("does not create a fake favorite or file when disk fails",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    r.failNext();
    expect((await p.submit(new Uint8Array(16))).ok).toBe(false);
    expect(r.recorded[0]!.aborted).toBe(true);
    expect(p.status.state).toBe("error");
    expect((await p.submit(new Uint8Array(16))).ok).toBe(false);
  });
  it("two concurrent stops never finish the same WAV twice",async()=>{
    const r=rig();let finishes=0;
    const store={...r.store,finish:async(id:string)=>{finishes++;return r.store.finish(id);}};
    const p=new GeneratedPcmSession(r.sink,store,DEFAULT_SETTINGS,[]);
    const chunk=new Uint8Array(PCM_TRANSFER_BYTES*16);
    for(let i=0;i<PCM_MINIMUM_SAVE_BYTES/chunk.length;i++)
      expect((await p.submit(chunk)).ok).toBe(true);
    const [a,b]=await Promise.all([p.stop(),p.stop()]);
    expect(a.ok&&b.ok).toBe(true);
    expect(finishes).toBe(1);
    expect(p.status.completedClips).toBe(1);
  });
  it("a disk failure stops audible output as well as aborting the incomplete WAV",async()=>{
    const r=rig();let stops=0;
    const sink={...r.sink,stop:async()=>{stops++;}};
    const p=new GeneratedPcmSession(sink,r.store,DEFAULT_SETTINGS,[]);
    r.failNext();
    expect((await p.submit(new Uint8Array(16))).ok).toBe(false);
    expect(stops).toBe(1);
    expect(r.recorded[0]!.aborted).toBe(true);
  });
  it("stopping a session closes the native audio output exactly once",async()=>{
    const r=rig();let stops=0;
    const p=new GeneratedPcmSession({...r.sink,stop:async()=>{stops++;}},r.store,DEFAULT_SETTINGS,[]);
    await p.submit(new Uint8Array(16));
    const [a,b]=await Promise.all([p.stop(),p.stop()]);
    expect(a.ok&&b.ok).toBe(true);
    expect(stops).toBe(1);
  });
  it("a blocked output times out and aborts only its incomplete WAV",async()=>{
    vi.useFakeTimers();
    try{
      const r=rig();
      const hung={append:async():Promise<Result<"queued">>=>new Promise(()=>{})};
      const p=new GeneratedPcmSession(hung,r.store,DEFAULT_SETTINGS,[]);
      const pending=p.submit(new Uint8Array(4));
      await vi.advanceTimersByTimeAsync(12001);
      const failed=await pending;
      expect(failed.ok).toBe(false);
      expect(p.status.state).toBe("error");
      expect(r.recorded[0]?.aborted).toBe(true);
    }finally{vi.useRealTimers();}
  });
  it("60 seconds saves a real WAV, a shorter incomplete segment never does",async()=>{
    const chunk=new Uint8Array(PCM_TRANSFER_BYTES*16);
    const justUnder=rig(),short=new GeneratedPcmSession(justUnder.sink,justUnder.store,DEFAULT_SETTINGS,[]);
    const chunksAt60=PCM_MINIMUM_SAVE_BYTES/chunk.length;
    for(let i=0;i<chunksAt60-1;i++)await short.submit(chunk);
    await short.stop();
    expect(justUnder.recorded[0]).toMatchObject({finished:false,aborted:true});
    expect(short.status.completedClips).toBe(0);

    const enough=rig(),real=new GeneratedPcmSession(enough.sink,enough.store,DEFAULT_SETTINGS,[]);
    for(let i=0;i<chunksAt60;i++)await real.submit(chunk);
    expect(enough.recorded[0]!.length).toBe(PCM_MINIMUM_SAVE_BYTES);
    await real.stop();
    expect(enough.recorded[0]).toMatchObject({finished:true,aborted:false});
    expect(real.status.completedClips).toBe(1);
  });
  it("enforces 120 second clip boundary without losing frames",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    // Several realistic PCM blocks rather than allocating a single bridge packet.
    const pcm=new Uint8Array(PCM_TRANSFER_BYTES*16);
    for(let i=0;i<PCM_SEGMENT_BYTES/pcm.length;i++)expect((await p.submit(pcm)).ok).toBe(true);
    expect(r.recorded[0]!.length).toBe(PCM_SEGMENT_BYTES);
    expect(r.recorded[0]!.finished).toBe(true);
    await p.submit(new Uint8Array(12));
    await p.stop();
    expect(r.recorded[1]!.length).toBe(12);
    expect(r.recorded[1]!.finished).toBe(false);
    expect(r.recorded[1]!.aborted).toBe(true);
  });
});
