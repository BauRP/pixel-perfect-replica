import {describe,it,expect} from "vitest";
import {groupRealJourney} from "../lib/sw/journey";
import type {ClipMeta} from "../lib/sw/engine";
const mk=(id:string,at:number,durationSec=60):ClipMeta=>({
  id,createdAt:at,durationSec,genreIds:[],mood:0,speed:0,favorite:false,
  uri:"file:///data/user/0/kz.soundworld.ar/files/generated_music/"+id+".wav",
});
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
const c="33333333-3333-4333-8333-333333333333";
describe("Real offline music journey without GPS",()=>{
  it("sorts by real timestamp, groups by calendar date and totals duration",()=>{
    const clips=[mk(a,new Date(2026,9,4,7).getTime(),80),
      mk(b,new Date(2026,9,5,9).getTime(),120),
      mk(c,new Date(2026,9,5,8).getTime(),60)];
    const days=groupRealJourney(clips);
    expect(days).toHaveLength(2);
    expect(days[0]!.dayKey).toBe("2026-10-05");
    expect(days[0]!.count).toBe(2);
    expect(days[0]!.minutes).toBe(3);
    expect(days[0]!.clips.map(x=>x.id)).toEqual([b,c]);
  });
  it("never invents entries, ignores invalid and duplicate metadata",()=>{
    const x=mk(a,new Date(2026,9,5).getTime());
    expect(groupRealJourney([x,x,{...x,id:"fake"},{...x,uri:""},mk(b,0)])).toHaveLength(1);
    expect(groupRealJourney([x,x])[0]!.count).toBe(1);
    expect(groupRealJourney([])).toEqual([]);
  });
});
