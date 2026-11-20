import {describe,it,expect,vi} from "vitest";
import {streamRealMidiScores} from "../lib/sw/continuous-midi-scores";
describe("bounded MIDI composition sequence",()=>{
  it("streams two hours without a two-hour buffer",async()=>{
    let index=0,completed=0;const frames=60*48000;
    const result=await streamRealMidiScores({
      next:async()=>++index<=120?{id:index}:null,
    },async(score,progress)=>{
      completed++;
      expect((score as {id:number}).id).toBe(completed);
      progress({renderedFrames:frames-11*48000,totalFrames:frames});
      progress({renderedFrames:frames,totalFrames:frames});
      return {ok:true,frames};
    },{maxScores:120});
    expect(result).toEqual({ok:true,completedScores:120,totalFrames:120*frames});
    expect(index).toBe(120);
  });
  it("abort cancels an unresolved model request",async()=>{
    const controller=new AbortController(),render=vi.fn();
    const pending=streamRealMidiScores({next:async()=>new Promise<null>(()=>{})},render,{signal:controller.signal});
    controller.abort();
    await expect(pending).resolves.toMatchObject({ok:false,code:"UNAVAILABLE"});
    expect(render).not.toHaveBeenCalled();
  });
  it("does not invent an empty composition",async()=>{
    const render=vi.fn();
    await expect(streamRealMidiScores({next:async()=>null},render))
      .resolves.toMatchObject({ok:false,completedScores:0});
    expect(render).not.toHaveBeenCalled();
  });
  it("rejects broken progress reported by synth",async()=>{
    await expect(streamRealMidiScores({next:async()=>({any:true})},
      async(_score,onProgress)=>{onProgress({renderedFrames:200,totalFrames:100});return {ok:true,frames:100};}))
      .resolves.toMatchObject({ok:false,code:"ERROR"});
  });
});

describe("genuine model lifecycle deadlines",()=>{
  it("does not hang when native MNN never answers",async()=>{
    vi.useFakeTimers();
    try{
      let aborted=false;
      const task=streamRealMidiScores({next:async(signal)=>new Promise<null>(()=>{
        signal?.addEventListener("abort",()=>{aborted=true;});
      })},async()=>({ok:true,frames:1}),{maxScoreWaitMs:1000});
      await vi.advanceTimersByTimeAsync(1001);
      expect(await task).toMatchObject({ok:false,code:"ERROR",completedScores:0});
      expect(aborted).toBe(true);
    }finally{vi.useRealTimers();}
  });
  it("responds to manual stop even when only isCancelled exists",async()=>{
    vi.useFakeTimers();
    try{
      let stopped=false;
      const task=streamRealMidiScores({next:async()=>new Promise<null>(()=>{})},
        async()=>({ok:true,frames:1}),{maxScoreWaitMs:1000,isCancelled:()=>stopped});
      await vi.advanceTimersByTimeAsync(20);
      stopped=true;
      await vi.advanceTimersByTimeAsync(120);
      expect(await task).toMatchObject({ok:false,code:"UNAVAILABLE"});
    }finally{vi.useRealTimers();}
  });
  it("rejects invalid deadlines before calling the model",async()=>{
    const next=vi.fn(async()=>null);
    expect(await streamRealMidiScores({next},async()=>({ok:true,frames:1}),{maxScoreWaitMs:0}))
      .toMatchObject({ok:false,code:"ERROR"});
    expect(next).not.toHaveBeenCalled();
  });
});
