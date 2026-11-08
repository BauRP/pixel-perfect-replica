/**
 * Builds a truthful request for a future LOCAL music model.
 * Preference guidance is not a promise that MRT2 supports every instrument.
 * No audio generation or fake playback happens here.
 */
import { effectiveDirections, type Settings } from "./settings";
import type { ClipMeta } from "./engine";
import type { ControlPlan } from "./music-control";
export interface MusicRequest {
  lengthSeconds: 120;
  instrumental: true;
  genreCandidates: string[];
  emphasizedGenres: string[];
  excludedGenres: string[];
  preferredInstruments: string[];
  excludedInstruments: string[];
  mood: number;
  compositionBpm: number;
  stepAccentBpm: number | null;
  atmosphere: ControlPlan["atmosphere"];
  transitionMs: number;
  directorEffects: string[];
}
export function buildMusicRequest(settings:Settings, plan:ControlPlan, favorites:ClipMeta[]):MusicRequest {
  const allowed = effectiveDirections(settings);
  const excluded = new Set(Object.entries(settings.dislikes)
    .filter(([,v])=>v==="excluded").map(([k])=>k));
  const disallowedParents = new Set(allowed.filter(x=>!x.includes("-")&&excluded.has(x)));
  const allowedGenres=allowed.filter(id=>{
    if(excluded.has(id))return false;
    if(id.includes("-"))return !disallowedParents.has(id.split("-")[0]!);
    return true;
  });
  // A heart is positive guidance only. No heart is NOT negative feedback.
  const score=new Map<string,number>();
  for(const clip of favorites) {
    if(!clip.favorite)continue;
    for(const genre of clip.genreIds) {
      if(allowedGenres.includes(genre))score.set(genre,(score.get(genre)??0)+1);
    }
  }
  const emphasizedGenres=[...score.keys()].sort((a,b)=>(score.get(b)??0)-(score.get(a)??0));
  return {
    lengthSeconds:120, instrumental:true, genreCandidates:allowedGenres,
    emphasizedGenres, excludedGenres:[...excluded],
    preferredInstruments:settings.favoriteInstrumentIds.filter(id=>!excluded.has(id)),
    excludedInstruments:settings.favoriteInstrumentIds.filter(id=>excluded.has(id))
      .concat(Object.keys(settings.dislikes).filter(k=>excluded.has(k)&&k.startsWith("i"))),
    mood:settings.mood, compositionBpm:plan.tempoBpm,
    stepAccentBpm:plan.stepPulseBpm,atmosphere:plan.atmosphere,
    transitionMs:plan.transitionMs,directorEffects:plan.directorEffects,
  };
}
