import {describe,it,expect,vi} from "vitest";
import {renderVerifiedMidiToPcm} from "../lib/sw/verified-midi-pcm-bridge";
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
  it("does not count a partial native PCM submission as completed",async()=>{
    const result=await renderVerifiedMidiToPcm(valid(),{
      ready:async()=>true,render:async x=>new Uint8Array(x.frameCount*4),
    },{submit:async()=>({ok:true,value:4})});
    expect(result.ok).toBe(false);
  });
});
