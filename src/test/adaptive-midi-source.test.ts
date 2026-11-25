import {describe,it,expect,vi} from "vitest";
import {AdaptiveMidiSource} from "../lib/sw/adaptive-midi-source";
import type {MusicRequest} from "../lib/sw/music-preferences";
import {DEFAULT_SETTINGS} from "../lib/sw/settings";
import {MusicControlPlanner} from "../lib/sw/music-control";
const score=()=>({durationUs:60_000_000,notes:[{
  track:0,channel:0,program:2,pitch:60,velocity:96,startUs:0,endUs:60_000_000,
}]});
describe("local, instrument-only adaptive model handoff",()=>{
  const setup=()=>{
    let revision=1;
    const settings={...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01","g02-s01"],
      dislikes:{"g01-s01":"excluded" as const,"i1-01":"excluded" as const} as Record<string,"excluded"|"notPreferred">};
    const planner=new MusicControlPlanner();
    const inputs={
      currentSettings:()=>settings,
      currentPlan:()=>planner.plan(settings,1000),
      currentFavorites:()=>[],
      revision:()=>revision,
    };
    return {inputs,settings,change:()=>{revision++;}};
  };
  it("sends hard exclusions, instrument-only request and real genre",async()=>{
    const s=setup(),generate=vi.fn(async(_request:unknown)=>score());
    const source=new AdaptiveMidiSource({generate},s.inputs);
    const result=await source.next();
    expect(result).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
    const req=generate.mock.calls[0]![0] as MusicRequest;
    expect(req.instrumental).toBe(true);
    expect(req.genreCandidates).toContain("g02-s01");
    expect(req.genreCandidates).not.toContain("g01-s01");
    expect(req.excludedInstruments).toContain("i1-01");
    expect(Object.isFrozen(req)).toBe(true);
  });
  it("refuses to generate when all user-selected genres are blocked",async()=>{
    const s=setup();s.settings.dislikes["g02-s01"]="excluded";
    const generate=vi.fn(async(_request:unknown)=>score());
    await expect(new AdaptiveMidiSource({generate},s.inputs).next()).rejects.toThrow("исключены");
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects a late score from previous preferences",async()=>{
    const s=setup();let release:(v:unknown)=>void=()=>undefined;
    const source=new AdaptiveMidiSource({generate:()=>new Promise(resolve=>{release=resolve;})},s.inputs);
    const pending=source.next();await Promise.resolve();await Promise.resolve();s.change();release(score());
    await expect(pending).rejects.toThrow("Настройки изменились");
  });
  it("stops waiting if the user cancels a hanging music generation",async()=>{
    const s=setup(),controller=new AbortController();
    const source=new AdaptiveMidiSource({generate:()=>new Promise(()=>{})},s.inputs);
    const pending=source.next(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("остановлена");
  });
  it("passes exact original Fermata header to the genuine model adapter",async()=>{
    const s=setup();
    const observed:string[][]=[];
    const source=new AdaptiveMidiSource({generate:async(_request,_signal,conditioning)=>{
      observed.push([...conditioning.tokens]);
      return score();
    }},s.inputs);
    expect(await source.next()).not.toBeNull();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toContain("<GENRE_electronic>");
    expect(observed[0]).toContain("<PLAN_END>");
    expect(observed[0]).not.toContain("<TRACK_0>");
  });
  it("rejects a hanging native generator within the time limit",async()=>{
    vi.useFakeTimers();
    try{
      const s=setup();
      const source=new AdaptiveMidiSource({generate:async()=>new Promise<null>(()=>{})},
        s.inputs,1000);
      const task=source.next();
      const assertion=expect(task).rejects.toThrow("не ответила");
      await vi.advanceTimersByTimeAsync(1010);
      await assertion;
    }finally{vi.useRealTimers();}
  });
  it("invalidates a hung generator on preferences revision, without waiting 2min",async()=>{
    vi.useFakeTimers();
    try{
      const s=setup();
      const source=new AdaptiveMidiSource({generate:async()=>new Promise<null>(()=>{})},
        s.inputs,5000);
      const task=source.next();
      const assertion=expect(task).rejects.toThrow("Настройки изменились");
      await vi.advanceTimersByTimeAsync(30);
      s.change();
      await vi.advanceTimersByTimeAsync(280);
      await assertion;
    }finally{vi.useRealTimers();}
  });
  it("rejects unsupported favorite timbre instead of silently substituting it",async()=>{
    const s=setup();
    s.settings.favoriteInstrumentIds=["i8-01"];
    const generate=vi.fn(async()=>score());
    await expect(new AdaptiveMidiSource({generate},s.inputs).next())
      .rejects.toThrow("General MIDI");
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects an actual decoded score containing an excluded piano",async()=>{
    const s=setup();
    const forbidden=score();
    forbidden.notes[0]!.program=0;
    const source=new AdaptiveMidiSource({generate:async()=>forbidden},s.inputs);
    await expect(source.next()).rejects.toThrow("запрещённую");
  });
  it("rejects percussion emitted despite a hard percussion exclusion",async()=>{
    const s=setup();
    s.settings.dislikes["i5-02"]="excluded";
    const forbidden=score();
    forbidden.notes[0]!.channel=9;
    const source=new AdaptiveMidiSource({generate:async()=>forbidden},s.inputs);
    await expect(source.next()).rejects.toThrow("запрещённую");
  });
  it("does not start a second native operation while a cancelled one is still running",async()=>{
    const s=setup(),controller=new AbortController();
    let release:(v:unknown)=>void=()=>undefined;
    const generate=vi.fn(()=>new Promise<unknown>(resolve=>{release=resolve;}));
    const source=new AdaptiveMidiSource({generate},s.inputs);
    const pending=source.next(controller.signal);
    const cancelled=expect(pending).rejects.toThrow("остановлена");
    await Promise.resolve();
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
    controller.abort();
    await cancelled;
    await expect(source.next()).rejects.toThrow("Предыдущая генерация");
    expect(generate).toHaveBeenCalledTimes(1);
    release(score());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const next=source.next();
    await Promise.resolve();
    await Promise.resolve();
    release(score());
    expect(await next).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid 11-second output instead of accepting fabricated music",async()=>{
    const s=setup();
    const source=new AdaptiveMidiSource({
      generate:async()=>({durationUs:11_000_000,notes:[]}),
    },s.inputs);
    await expect(source.next()).rejects.toThrow("неправильную партитуру");
  });
});
