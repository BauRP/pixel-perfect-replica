import {describe,it,expect} from "vitest";
import {GENRES,INSTRUMENTS,ALL_SUBGENRE_IDS} from "../lib/sw/catalog";
import {DEFAULT_SETTINGS,getSettingsSnapshot,updateSettings,toggleFavoriteInstrument,setDislike} from "../lib/sw/settings";
import {effectivePreferences,studioSelectedGenres} from "../lib/sw/effective-preferences";

describe("real Studio preferences after exclusions",()=>{
  it("derives selected genres from current settings after an external edit or reset",()=>{
    const first=ALL_SUBGENRE_IDS[0]!,second=ALL_SUBGENRE_IDS[1]!;
    const initial={...DEFAULT_SETTINGS,allowedAllGenres:false,chosenGenreIds:[first]};
    const changed={...initial,chosenGenreIds:[second]};
    expect([...studioSelectedGenres(initial)]).toEqual([first]);
    expect([...studioSelectedGenres(changed)]).toEqual([second]);
    expect(studioSelectedGenres({...changed,allowedAllGenres:true}).size).toBe(ALL_SUBGENRE_IDS.length);
    expect(studioSelectedGenres({...changed,chosenGenreIds:[]}).size).toBe(0);
  });
  it("parent excluded group blocks its subgenres but keeps other choices",()=>{
    const a=GENRES[0]!,b=GENRES[1]!;
    const s={...DEFAULT_SETTINGS,chosenGenreIds:[
      a.subgenres[0]!.id,a.subgenres[1]!.id,b.subgenres[0]!.id],
      dislikes:{[a.id]:"excluded" as const}};
    const x=effectivePreferences(s);
    expect(x.allowedSubgenres).toEqual([b.subgenres[0]!.id]);
    expect(x.blockedSelectedSubgenres).toBe(2);
    expect(x.hasPlayablePreferences).toBe(true);
  });
  it("all genres selected still respects parent and child exclusions once",()=>{
    const a=GENRES[0]!,b=GENRES[1]!;
    const x=effectivePreferences({...DEFAULT_SETTINGS,
      allowedAllGenres:true,chosenGenreIds:[],
      dislikes:{[a.id]:"excluded" as const,
        [a.subgenres[0]!.id]:"excluded" as const,
        [b.subgenres[0]!.id]:"excluded" as const}});
    expect(x.blockedSelectedSubgenres).toBe(a.subgenres.length+1);
    expect(x.allowedSubgenres).toHaveLength(ALL_SUBGENRE_IDS.length-a.subgenres.length-1);
  });
  it("excluded instruments cannot appear in effective favorites",()=>{
    const a=INSTRUMENTS[0]!.items[0]!.id,b=INSTRUMENTS[0]!.items[1]!.id;
    const x=effectivePreferences({...DEFAULT_SETTINGS,
      favoriteInstrumentIds:[a,b,b,"invalid"],
      dislikes:{[a]:"excluded" as const}});
    expect(x.allowedFavoriteInstruments).toEqual([b]);
    expect(x.blockedFavoriteInstruments).toBe(1);
  });
  it("warns on zero usable genres without modifying saved choices",()=>{
    const group=GENRES[0]!;
    const s={...DEFAULT_SETTINGS,chosenGenreIds:[group.subgenres[0]!.id],
      dislikes:{[group.id]:"excluded" as const}};
    expect(effectivePreferences(s).hasPlayablePreferences).toBe(false);
    expect(s.chosenGenreIds).toHaveLength(1);
  });

  it("preserves newer settings and exclusions when a favorite click follows an older render",()=>{
    const a=INSTRUMENTS[0]!.items[0]!.id,b=INSTRUMENTS[0]!.items[1]!.id,c=INSTRUMENTS[0]!.items[2]!.id;
    const before=getSettingsSnapshot();
    try {
      updateSettings(()=>({...DEFAULT_SETTINGS,favoriteInstrumentIds:[a]}));
      const oldRender=getSettingsSnapshot();
      updateSettings(s=>({...s,mood:4,favoriteInstrumentIds:[...s.favoriteInstrumentIds,b]}));
      updateSettings(current=>toggleFavoriteInstrument(current,c).next);
      expect(getSettingsSnapshot().favoriteInstrumentIds).toEqual([a,b,c]);
      expect(getSettingsSnapshot().mood).toBe(4);
      expect(oldRender.favoriteInstrumentIds).toEqual([a]);
      updateSettings(current=>setDislike(current,c,"excluded"));
      updateSettings(current=>toggleFavoriteInstrument(current,c).next);
      expect(getSettingsSnapshot().favoriteInstrumentIds).toEqual([a,b]);
      expect(getSettingsSnapshot().dislikes[c]).toBe("excluded");
    } finally {
      updateSettings(()=>before);
    }
  });
});
