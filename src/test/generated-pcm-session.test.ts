import { describe, it, expect } from "vitest";
import { GeneratedPcmSession, PCM_SEGMENT_BYTES, PCM_TRANSFER_BYTES } from "../lib/sw/generated-pcm-session";
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
    expect(r.recorded).toEqual([{id:"1",length:480,finished:true,aborted:false}]);
  });
  it("copies reused source buffers and uses bounded packets",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    const chunk=new Uint8Array(PCM_TRANSFER_BYTES+4);
    const a=p.submit(chunk); chunk.fill(7);
    expect((await a).ok).toBe(true);
    expect(r.sent).toEqual([PCM_TRANSFER_BYTES,4]);
  });
  it("does not create a fake favorite or file when disk fails",async()=>{
    const r=rig();const p=new GeneratedPcmSession(r.sink,r.store,DEFAULT_SETTINGS,[]);
    r.failNext();
    expect((await p.submit(new Uint8Array(16))).ok).toBe(false);
    expect(r.recorded[0]!.aborted).toBe(true);
    expect(p.status.state).toBe("error");
    expect((await p.submit(new Uint8Array(16))).ok).toBe(false);
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
    expect(r.recorded[1]!.finished).toBe(true);
  });
});
