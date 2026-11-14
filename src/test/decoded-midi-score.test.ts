import {describe,it,expect} from "vitest";
import {validateDecodedMidiScore} from "../lib/sw/decoded-midi-score";

const score = () => ({
  durationUs:120_000_000,
  notes:[
    {track:0,channel:0,program:0,pitch:60,velocity:96,startUs:0,endUs:40_000_000},
    {track:1,channel:9,program:0,pitch:38,velocity:110,startUs:250_000,endUs:320_000},
    {track:0,channel:0,program:0,pitch:64,velocity:90,startUs:35_000_000,endUs:85_000_000},
    {track:0,channel:0,program:0,pitch:67,velocity:90,startUs:80_000_000,endUs:120_000_000},
  ],
});

describe("Fermata decoded symbolic note safety boundary (not an audio generator)",()=>{
  it("accepts ordered, real-valued multi-track GM notes without creating audio",()=>{
    const input=score();
    const result=validateDecodedMidiScore(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.durationUs).toBe(120_000_000);
    expect(result.value.notes.map(n=>n.channel)).toEqual([0,9,0,0]);
    input.notes[0]!.pitch=72;
    expect(result.value.notes[0]!.pitch).toBe(60);
    expect(Object.isFrozen(result.value.notes)).toBe(true);
  });
  it("rejects missing, short, long and empty scores",()=>{
    expect(validateDecodedMidiScore(null).ok).toBe(false);
    expect(validateDecodedMidiScore({durationUs:60_000_000,notes:[]}).ok).toBe(false);
    expect(validateDecodedMidiScore({...score(),durationUs:59_999_999}).ok).toBe(false);
    expect(validateDecodedMidiScore({...score(),durationUs:120_000_001}).ok).toBe(false);
    expect(validateDecodedMidiScore({...score(),durationUs:NaN}).ok).toBe(false);
  });
  it("rejects fake 120-second duration with only a short musical passage",()=>{
    const base=score();
    const short=[{...base.notes[0],endUs:1_000_000}];
    expect(validateDecodedMidiScore({...base,notes:short}).ok).toBe(false);
    const trailing={...base,notes:base.notes.slice(0,3)};
    expect(validateDecodedMidiScore(trailing).ok).toBe(false);
    const giantRest={...base,notes:[
      {...base.notes[0],endUs:10_000_000},
      {...base.notes[3],startUs:80_000_000},
    ]};
    expect(validateDecodedMidiScore(giantRest).ok).toBe(false);
  });
  it("accepts overlapping tracks and musical rests shorter than 8 seconds",()=>{
    const valid=score();
    const notes=[
      {...valid.notes[0],endUs:52_000_000},
      {...valid.notes[2],startUs:59_000_000,endUs:105_000_000},
      {...valid.notes[3],startUs:112_000_000,endUs:120_000_000},
    ];
    expect(validateDecodedMidiScore({...valid,notes}).ok).toBe(true);
  });
  it("rejects unsorted, out-of-range, fractional and endless notes",()=>{
    const valid=score();
    const bad=(overrides:Record<string,unknown>)=>validateDecodedMidiScore({
      ...valid,notes:[{...valid.notes[0],...overrides}],
    }).ok;
    expect(bad({pitch:128})).toBe(false);
    expect(bad({pitch:-1})).toBe(false);
    expect(bad({velocity:0})).toBe(false);
    expect(bad({channel:16})).toBe(false);
    expect(bad({track:32})).toBe(false);
    expect(bad({program:-1})).toBe(false);
    expect(bad({startUs:0.5})).toBe(false);
    expect(bad({endUs:120_000_001})).toBe(false);
    expect(bad({endUs:0})).toBe(false);
    expect(bad({endUs:Infinity})).toBe(false);
    const outOfOrder=score();
    outOfOrder.notes[2]!.startUs=100_000;
    expect(validateDecodedMidiScore(outOfOrder).ok).toBe(false);
    expect(validateDecodedMidiScore({...valid,notes:Array(50_001).fill(valid.notes[0])}).ok).toBe(false);
  });
});
