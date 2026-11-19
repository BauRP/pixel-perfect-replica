import {describe,it,expect} from "vitest";
import {scheduleDecodedMidiNotes,midiEventFrame} from "../lib/sw/decoded-midi-events";
const score=()=>({durationUs:60_000_000,notes:[
  {track:0,channel:0,program:0,pitch:60,velocity:96,startUs:0,endUs:30_000_000},
  {track:1,channel:9,program:0,pitch:38,velocity:110,startUs:30_000_000,endUs:60_000_000},
  {track:0,channel:0,program:0,pitch:60,velocity:85,startUs:30_000_000,endUs:60_000_000},
]});
describe("real decoded score -> deterministic synthesizer event schedule",()=>{
  it("orders note-offs before next note-ons at the same timestamp",()=>{
    const result=scheduleDecodedMidiNotes(score());
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(result.events.map(x=>x.atUs)).toEqual([
      0,30_000_000,30_000_000,30_000_000,60_000_000,60_000_000,
    ]);
    expect(result.events[1]?.kind).toBe("noteOff");
    expect(result.events[2]?.kind).toBe("noteOn");
    expect(result.events[3]?.channel).toBe(0);
    expect(Object.isFrozen(result.events)).toBe(true);
  });
  it("preserves original GM channels and never invents audio",()=>{
    const result=scheduleDecodedMidiNotes(score());
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(result.events.filter(x=>x.kind==="noteOn").map(x=>x.channel))
      .toEqual([0,9,0]);
    expect(result.events.filter(x=>x.kind==="noteOff").every(x=>x.velocity===0)).toBe(true);
    expect(midiEventFrame(30_000_000)).toBe(1_440_000);
    expect(midiEventFrame(-1)).toBeNull();
    expect(midiEventFrame(NaN)).toBeNull();
  });
  it("rejects fake or truncated symbolic music before scheduling",()=>{
    expect(scheduleDecodedMidiNotes({...score(),durationUs:1_000_000}).ok).toBe(false);
    expect(scheduleDecodedMidiNotes({...score(),notes:[]}).ok).toBe(false);
  });
});
