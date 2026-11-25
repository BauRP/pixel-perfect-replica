import {describe,it,expect} from "vitest";
import {buildFermataConditioning,createFermataHeader} from "../lib/sw/fermata-conditioning";
import {buildMusicRequest} from "../lib/sw/music-preferences";
import {DEFAULT_SETTINGS,applySkipAllGenres} from "../lib/sw/settings";
import {MusicControlPlanner} from "../lib/sw/music-control";

const mk=(settings=DEFAULT_SETTINGS)=>buildMusicRequest(
  settings,new MusicControlPlanner().plan(settings,1000),[],
);
const active=()=>({...DEFAULT_SETTINGS,chosenGenreIds:["g02-s01"]});
describe("Fermata original conditioning tokens without fake notes",()=>{
  it("builds native musical tokens in exact model-card order",()=>{
    const x=createFermataHeader({
      genre:"popular",ensemble:"band",tempoBpm:130,keySignature:0,
      mode:"minor",numerator:4,denominator:4,programs:[30,29,33],drums:true,
    });
    expect(x.ok).toBe(true);
    if(!x.ok)return;
    expect(x.value.text).toBe(
      "<BOS> <GENRE_popular> <ENSEMBLE_band> <TEMPO_130> "+
      "<KEY_0:minor> <METER_4/4> <PLAN> <TRACK_30> <TRACK_29> "+
      "<TRACK_33> <DRUM_TRACK> <PLAN_END>");
    expect(x.value).not.toHaveProperty("tokenIds");
    expect(x.value).not.toHaveProperty("pcm");
  });
  it("fails closed on vocal ensemble or voice-like programs",()=>{
    expect(createFermataHeader({
      genre:"popular",ensemble:"choir",tempoBpm:100,keySignature:0,
      mode:"major",numerator:4,denominator:4,programs:[0],drums:false,
    }).ok).toBe(false);
    expect(createFermataHeader({
      genre:"popular",ensemble:"solo",tempoBpm:100,keySignature:0,
      mode:"major",numerator:4,denominator:4,programs:[52],drums:false,
    }).ok).toBe(false);
  });
  it("rejects invalid tempo, mode, or track while preserving original grammar",()=>{
    const base={genre:"popular" as const,ensemble:"solo" as const,
      tempoBpm:100,keySignature:0,mode:"major" as const,
      numerator:4,denominator:4 as const,programs:[0],drums:false};
    expect(createFermataHeader({...base,tempoBpm:0}).ok).toBe(false);
    expect(createFermataHeader({...base,keySignature:8}).ok).toBe(false);
    expect(createFermataHeader({...base,programs:[128]}).ok).toBe(false);
    expect(createFermataHeader({...base,programs:[0,0]}).ok).toBe(true);
  });
  it("maps real electronic genre, preferences and excluded piano to allowed parts",()=>{
    const s={...active(),dislikes:{"i1-01":"excluded" as const}};
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(true);
    if(!v.ok)return;
    expect(v.value.text).toContain("<GENRE_electronic>");
    expect(v.value.text).not.toContain("<TRACK_0>");
    expect(v.value.text).toContain("<TRACK_4>");
  });
  it("maps additional real GM instruments and aliases",()=>{
    const s={...active(),favoriteInstrumentIds:["i3-03","i6-10","i8-03"]};
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(true);
    if(v.ok)expect(v.value.programs).toEqual([24,22,104]);
  });
  it("honors rain and step arrangement signals without violating drum exclusion",()=>{
    const rain=buildFermataConditioning({...mk(active()),directorEffects:["soften-arrangement"]});
    expect(rain.ok&&rain.value.drums).toBe(false);
    const stepped=buildFermataConditioning({...mk(active()),directorEffects:["soften-arrangement","accent-step-percussion"]});
    expect(stepped.ok&&stepped.value.drums).toBe(true);
    const banned=buildFermataConditioning({...mk(active()),directorEffects:["accent-step-percussion"],excludedInstruments:["i2-07"]});
    expect(banned.ok&&banned.value.drums).toBe(false);
  });
  it("rotates selected genre families for moderate diversity, but not familiar",()=>{
    const request=mk({...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01","g02-s01"]});
    const first=buildFermataConditioning({...request,diversity:"moderate"},0);
    const second=buildFermataConditioning({...request,diversity:"moderate"},1);
    const familiar=buildFermataConditioning({...request,diversity:"familiar"},1);
    expect(first.ok&&first.value.genre).toBe("popular");
    expect(second.ok&&second.value.genre).toBe("electronic");
    expect(familiar.ok&&familiar.value.genre).toBe("popular");
  });
  it("does not permanently discard the seventh supported favorite",()=>{
    const s={...active(),favoriteInstrumentIds:["i1-01","i1-03","i1-05","i3-01","i3-02","i3-03","i6-06"]};
    const first=buildFermataConditioning(mk(s),0);
    const second=buildFermataConditioning(mk(s),1);
    expect(first.ok&&first.value.programs.includes(73)).toBe(false);
    expect(second.ok&&second.value.programs.includes(73)).toBe(true);
  });
  it("never silently substitutes a favorite dombyra with a piano",()=>{
    const s={...active(),favoriteInstrumentIds:["i8-01"]};
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(false);
    if(!v.ok)expect(v.reason).toContain("General MIDI");
  });
  it("excludes drums when any drum part is hard excluded",()=>{
    const s={...active(),dislikes:{"i5-02":"excluded" as const}};
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(true);
    if(v.ok)expect(v.value.tokens).not.toContain("<DRUM_TRACK>");
  });
  it("can only use selected subgenres, never prohibited parent directions",()=>{
    const s={...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01","g02-s01"],
      dislikes:{"g01":"excluded" as const}};
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(true);
    if(v.ok)expect(v.value.genre).toBe("electronic");
  });
  it("never returns music if all genres are excluded",()=>{
    const s={...active(),dislikes:{"g02":"excluded" as const}};
    expect(buildFermataConditioning(mk(s)).ok).toBe(false);
  });
  it("supports full user catalog after Skip but uses only model-supported coarse genres",()=>{
    const s=applySkipAllGenres(DEFAULT_SETTINGS);
    const v=buildFermataConditioning(mk(s));
    expect(v.ok).toBe(true);
    if(v.ok)expect(v.value.genre).toBe("popular");
  });
});
