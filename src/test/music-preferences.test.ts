import {describe,it,expect} from "vitest";
import {DEFAULT_SETTINGS,applySkipAllGenres,migrateSettings} from "../lib/sw/settings";
import {MusicControlPlanner} from "../lib/sw/music-control";
import {buildMusicRequest} from "../lib/sw/music-preferences";
import type {ClipMeta} from "../lib/sw/engine";
const plan=new MusicControlPlanner().plan(DEFAULT_SETTINGS,1000);
const clip=(fav:boolean):ClipMeta=>({id:"a",createdAt:1,durationSec:120,genreIds:["g01-s01"],mood:0,speed:0,favorite:fav});
describe("future Magenta request must reflect actual user preferences",()=>{
  it("skip grants all 150 until user excludes a genre",()=>{
    const a=applySkipAllGenres(DEFAULT_SETTINGS);
    expect(buildMusicRequest(a,plan,[]).genreCandidates).toHaveLength(150);
    const b={...a,dislikes:{"g01-s01":"excluded" as const}};
    expect(buildMusicRequest(b,plan,[]).genreCandidates).not.toContain("g01-s01");
  });
  it("favorites boost permitted music but lack of a heart never means dislike",()=>{
    const settings={...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01"]};
    expect(buildMusicRequest(settings,plan,[clip(false)]).emphasizedGenres).toEqual([]);
    expect(buildMusicRequest(settings,plan,[clip(true)]).emphasizedGenres).toEqual(["g01-s01"]);
  });
  it("excludes selected subgenres when their whole parent is excluded",()=>{
    const s={...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01","g01-s02","g05-s01"],
      dislikes:{"g01":"excluded" as const}};
    const r=buildMusicRequest(s,plan,[]);
    expect(r.genreCandidates).toEqual(["g05-s01"]);
    expect(r.excludedGenres).toContain("g01");
  });
  it("separates disliked instruments from genres and ignores corrupted IDs",()=>{
    const s=migrateSettings({chosenGenreIds:["g01-s01"],favoriteInstrumentIds:["i1-01","i1-02"],
      dislikes:{"i1-01":"excluded","i1-02":"notPreferred","g01-s01":"notPreferred","garbage":"excluded"}});
    const r=buildMusicRequest(s,plan,[clip(true)]);
    expect(r.excludedInstruments).toEqual(["i1-01"]);
    expect(r.excludedGenres).toEqual([]);
    expect(r.preferredInstruments).toEqual([]);
    expect(r.emphasizedGenres).toEqual([]);
    expect(r.genreCandidates).toContain("g01-s01");
  });
  it("passes weak dislikes without falsely excluding them",()=>{
    const s={...DEFAULT_SETTINGS,chosenGenreIds:["g01-s01","g01-s02","g02-s01"],
      dislikes:{"g01":"notPreferred" as const,"i1-02":"notPreferred" as const}};
    const r=buildMusicRequest(s,plan,[]);
    expect(r.genreCandidates).toContain("g01-s01");
    expect(r.excludedGenres).toEqual([]);
    expect(r.deemphasizedGenres).toContain("g01-s01");
    expect(r.deemphasizedGenres).toContain("g01-s02");
    expect(r.deemphasizedGenres).not.toContain("g02-s01");
    expect(r.deemphasizedInstruments).toContain("i1-02");
    expect(r.excludedInstruments).toEqual([]);
  });
  it("passes all 11 Studio control intentions without claiming generated audio",()=>{
    const s={...DEFAULT_SETTINGS,diversity:"experimental" as const,
      environmentReaction:"strong" as const,useOfEnvironmentSounds:"mixProcessed" as const,
      activityMode:"walking" as const,stepsInfluence:"active" as const};
    const p=new MusicControlPlanner(),plan=p.plan(s,2000);
    const r=buildMusicRequest(s,plan,[]);
    expect(r.diversity).toBe("experimental");
    expect(r.activity).toBe("walking");
    expect(r.stepAccentStrength).toBe(.6);
    expect(r.allowProcessedAmbientAudio).toBe(true);
    expect(r).not.toHaveProperty("pcm");
  });
  it("instrumental is mandatory; segment max is 120 s; no song is generated",()=>{
    const x=buildMusicRequest(DEFAULT_SETTINGS,plan,[]);
    expect(x.instrumental).toBe(true);expect(x.lengthSeconds).toBe(120);
    expect(x).not.toHaveProperty("audio");
  });
});
