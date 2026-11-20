import {describe,it,expect,vi} from "vitest";
import {AdaptiveMidiSource} from "../lib/sw/adaptive-midi-source";
import {DEFAULT_SETTINGS} from "../lib/sw/settings";
import {MusicControlPlanner} from "../lib/sw/music-control";
const score=()=>({durationUs:60_000_000,notes:[{
  track:0,channel:0,program:0,pitch:60,velocity:96,startUs:0,endUs:60_000_000,
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
    const req=generate.mock.calls[0]![0];
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
    const pending=source.next();s.change();release(score());
    await expect(pending).rejects.toThrow("Настройки изменились");
  });
  it("stops waiting if the user cancels a hanging music generation",async()=>{
    const s=setup(),controller=new AbortController();
    const source=new AdaptiveMidiSource({generate:()=>new Promise(()=>{})},s.inputs);
    const pending=source.next(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("остановлена");
  });
  it("rejects invalid 11-second output instead of accepting fabricated music",async()=>{
    const s=setup();
    const source=new AdaptiveMidiSource({
      generate:async()=>({durationUs:11_000_000,notes:[]}),
    },s.inputs);
    await expect(source.next()).rejects.toThrow("неправильную партитуру");
  });
});
