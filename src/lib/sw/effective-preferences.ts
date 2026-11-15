/** Current saved user choices AFTER excluding parent genres and subgenres.
 * Not a claim about sound generation: Fermata is not integrated.
 */
import {ALL_SUBGENRE_IDS,GENRES,INSTRUMENTS} from "./catalog";
import type {Settings} from "./settings";

export interface EffectivePreferences {
  allowedSubgenres:readonly string[];
  blockedSelectedSubgenres:number;
  allowedFavoriteInstruments:readonly string[];
  blockedFavoriteInstruments:number;
  hasPlayablePreferences:boolean;
}
export function effectivePreferences(
  s:Pick<Settings,"allowedAllGenres"|"chosenGenreIds"|"dislikes"|"favoriteInstrumentIds">,
):EffectivePreferences {
  const selected=new Set(s.allowedAllGenres?ALL_SUBGENRE_IDS:s.chosenGenreIds);
  const allowedSubgenres:string[]=[];
  let blockedSelectedSubgenres=0;
  for(const group of GENRES){
    const parentExcluded=s.dislikes[group.id]==="excluded";
    for(const sub of group.subgenres){
      if(!selected.has(sub.id))continue;
      if(parentExcluded||s.dislikes[sub.id]==="excluded")blockedSelectedSubgenres++;
      else allowedSubgenres.push(sub.id);
    }
  }
  const allowedIds=new Set(INSTRUMENTS.flatMap(g=>g.items.map(x=>x.id)));
  const seen=new Set<string>();
  const allowedFavoriteInstruments:string[]=[];
  let blockedFavoriteInstruments=0;
  for(const id of s.favoriteInstrumentIds){
    if(!allowedIds.has(id)||seen.has(id))continue;
    seen.add(id);
    if(s.dislikes[id]==="excluded")blockedFavoriteInstruments++;
    else allowedFavoriteInstruments.push(id);
  }
  return {allowedSubgenres,blockedSelectedSubgenres,allowedFavoriteInstruments,
    blockedFavoriteInstruments,hasPlayablePreferences:allowedSubgenres.length>0};
}
