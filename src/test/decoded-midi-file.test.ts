import {describe,it,expect} from "vitest";
import {encodeDecodedMidiFile} from "../lib/sw/decoded-midi-events";
describe("real score Standard MIDI serialization",()=>{
  it("writes header, fixed tempo, program, notes and end-of-track",()=>{
    const data=encodeDecodedMidiFile({durationUs:60_000_000,notes:[
      {track:0,channel:0,program:40,pitch:60,velocity:90,startUs:0,endUs:60_000_000}
    ]});
    expect([...data.slice(0,14)]).toEqual([77,84,104,100,0,0,0,6,0,0,0,1,1,244]);
    expect(new DataView(data.buffer).getUint32(18)).toBe(data.length-22);
    expect([...data.slice(22,36)]).toEqual([0,255,81,3,7,161,32,0,192,40,0,144,60,90]);
    expect([...data.slice(-3)]).toEqual([255,47,0]);
  });
});
