import {describe,it,expect,vi} from "vitest";
import {renderVerifiedMidiToPcm,renderContinuousVerifiedMidiToPcm} from "../lib/sw/verified-midi-pcm-bridge";
const valid=()=>({durationUs:60_000_000,notes:[
  {track:0,channel:0,program:0,pitch:64,velocity:95,startUs:0,endUs:60_000_000},
]});
describe("genuine licensed MIDI synthesizer bridge (no fake production audio)",()=>{
  it("never starts rendering or buffering if genuine renderer is unavailable",async()=>{
    const render=vi.fn();
    const submit=vi.fn();
    const result=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>false,render,
    },{submit});
    expect(result.ok).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects truncated renderer PCM before touching output",async()=>{
    const submit=vi.fn();
    const outcome=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>true,render:async()=>new Uint8Array(4),
    },{submit});
    expect(outcome.ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });
  it("delivers verified events only once and stops without extra rendering",async()=>{
    const calls:{fromFrame:number;frameCount:number;events:number}[]=[];
    let cancelled=false;
    const outcome=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>true,
      render:async x=>{
        calls.push({fromFrame:x.fromFrame,frameCount:x.frameCount,events:x.events.length});
        return new Uint8Array(x.frameCount*4);
      },
    },{submit:async bytes=>{
      cancelled=true;
      return {ok:true,value:bytes.byteLength};
    }},{isCancelled:()=>cancelled});
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([{fromFrame:0,frameCount:12000,events:1}]);
  });
  it("delivers note-offs exactly at the terminal 60-second boundary",async()=>{
    let lastEventTypes:string[]=[];
    let chunks=0;
    const result=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>true,
      render:async x=>{
        chunks++;
        if(x.fromFrame+x.frameCount===2_880_000)
          lastEventTypes=x.events.map(e=>e.kind);
        return new Uint8Array(x.frameCount*4);
      },
    },{submit:async bytes=>({ok:true,value:bytes.byteLength})});
    expect(result).toEqual({ok:true,frames:2_880_000});
    expect(chunks).toBe(240);
    expect(lastEventTypes).toContain("noteOff");
  });
  it("does not count a partial native PCM submission as completed",async()=>{
    const result=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>true,render:async x=>new Uint8Array(x.frameCount*4),
    },{submit:async()=>({ok:true,value:4})});
    expect(result.ok).toBe(false);
  });
});

describe("genuine consecutive MIDI scores",()=>{
  it("sends 2 complete model scores, 120 seconds of verified PCM",async()=>{
    let fetched=0,rendered=0;
    const result=await renderContinuousVerifiedMidiToPcm({
      next:async()=>++fetched<=2?valid():null,
    },{
      ready:async()=>true,
      render:async input=>{rendered++;return new Uint8Array(input.frameCount*4);},
    },{submit:async bytes=>({ok:true,value:bytes.length})});
    expect(result).toEqual({ok:true,completedScores:2,totalFrames:5_760_000});
    expect(rendered).toBe(480);
    expect(fetched).toBe(3);
  });
  it("refuses invalid second scores and stops the native sink on error",async()=>{
    let fetched=0;
    const stop=vi.fn(async()=>({ok:true as const,value:undefined}));
    const result=await renderContinuousVerifiedMidiToPcm({
      next:async()=>++fetched===1?valid():{durationUs:11_000_000,notes:[]},
    },{
      ready:async()=>true,render:async input=>new Uint8Array(input.frameCount*4),
    },{submit:async bytes=>({ok:true,value:bytes.length}),stop});
    expect(result).toMatchObject({ok:false,completedScores:1});
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
