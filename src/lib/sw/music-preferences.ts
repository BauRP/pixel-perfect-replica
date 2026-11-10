/**
 * Builds a truthful request for a future LOCAL music model.
 * Preference guidance is not a promise that MRT2 supports every instrument.
 * No audio generation or fake playback happens here.
 */
import { effectiveDirections, type Settings } from "./settings";
import { instrumentNameById, genreNameById } from "./catalog";
import type { ClipMeta } from "./engine";
import type { ControlPlan } from "./music-control";
export interface MusicRequest {
  lengthSeconds: 120;
  instrumental: true;
  genreCandidates: string[];
  emphasizedGenres: string[];
  excludedGenres: string[];
  /** Soft negative preferences are not a ban: reduce frequency in future music. */
  deemphasizedGenres: string[];
  preferredInstruments: string[];
  excludedInstruments: string[];
  deemphasizedInstruments: string[];
  mood: number;
  compositionBpm: number;
  stepAccentBpm: number | null;
  atmosphere: ControlPlan["atmosphere"];
  transitionMs: number;
  directorEffects: string[];
  diversity: Settings["diversity"];
  activity: ControlPlan["activity"];
  density: number;
  stepAccentStrength: number;
  allowProcessedAmbientAudio: boolean;
}
export function buildMusicRequest(settings:Settings, plan:ControlPlan, favorites:ClipMeta[]):MusicRequest {
  const allowed = effectiveDirections(settings);
  const excluded = new Set(Object.entries(settings.dislikes)
    .filter(([,v])=>v==="excluded").map(([k])=>k));
  // Excluding a parent genre must remove its subgenres even for a partially
  // selected group (which does not appear as a parent in effectiveDirections).
  const disallowedParents=new Set([...excluded].filter(id=>/^g\d\d$/.test(id)));
  const allowedGenres=[...new Set(allowed.filter(id=>
    !excluded.has(id) && (!id.includes("-") || !disallowedParents.has(id.split("-")[0]!))
  ))];
  const notPreferred = new Set(Object.entries(settings.dislikes)
    .filter(([,level])=>level==="notPreferred").map(([id])=>id));
  const deemphasizedGenres=allowedGenres.filter(id => notPreferred.has(id) ||
    (id.includes("-") && notPreferred.has(id.split("-")[0]!)));
  const deemphasizedInstruments=Object.keys(settings.dislikes).filter(id=>
    settings.dislikes[id]==="notPreferred" && instrumentNameById[id]!==undefined);
  // A heart is positive guidance only. No heart is NOT negative feedback.
  const score=new Map<string,number>();
  for(const clip of favorites) {
    if(!clip.favorite)continue;
    for(const genre of clip.genreIds) {
      if(allowedGenres.includes(genre) && settings.dislikes[genre]!=="notPreferred")
        score.set(genre,(score.get(genre)??0)+1);
    }
  }
  const emphasizedGenres=[...score.keys()].sort((a,b)=>(score.get(b)??0)-(score.get(a)??0));
  return {
    lengthSeconds:120, instrumental:true, genreCandidates:allowedGenres,
    emphasizedGenres,
    excludedGenres:[...excluded].filter(id=>genreNameById[id]!==undefined),
    deemphasizedGenres,
    preferredInstruments:[...new Set(settings.favoriteInstrumentIds.filter(id=>
      instrumentNameById[id]!==undefined && !excluded.has(id) && settings.dislikes[id]!=="notPreferred"))],
    excludedInstruments:[...excluded].filter(id=>instrumentNameById[id]!==undefined),
    deemphasizedInstruments,
    mood:settings.mood, compositionBpm:plan.tempoBpm,
    stepAccentBpm:plan.stepPulseBpm,atmosphere:plan.atmosphere,
    transitionMs:plan.transitionMs,directorEffects:plan.directorEffects,
    diversity:settings.diversity,activity:plan.activity,density:plan.density,
    stepAccentStrength:plan.stepAccentStrength,
    allowProcessedAmbientAudio:plan.allowProcessedAmbientAudio,
  };
}
