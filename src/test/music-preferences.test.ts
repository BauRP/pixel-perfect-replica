import {describe,it,expect} from "vitest";
import {DEFAULT_SETTINGS,applySkipAllGenres} from "../lib/sw/settings";
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
  it("instrumental is mandatory; segment max is 120 s; no song is generated",()=>{
    const x=buildMusicRequest(DEFAULT_SETTINGS,plan,[]);
    expect(x.instrumental).toBe(true);expect(x.lengthSeconds).toBe(120);
    expect(x).not.toHaveProperty("audio");
  });
});
