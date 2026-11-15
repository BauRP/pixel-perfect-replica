/**
 * Truthful, UI-only preview of EXISTING Studio rules.
 * Never starts the microphone, never makes sound, and never claims Fermata
 * is integrated. Only newly received, confirmed native sensor events count.
 */
import {DIRECTOR_RULES,type Settings} from "./settings";
import type {Atmosphere} from "./environment-smoothing";

export type DirectorEvidence = Readonly<{
  ambient: Readonly<{at:number;atmosphere:Atmosphere;birdLabel:boolean}>|null;
  step: Readonly<{at:number;bpm:number}>|null;
}>;
export type DirectorRuleLiveState="off"|"waiting"|"detected";
export type DirectorRuleLiveItem=Readonly<{id:string;trigger:string;effect:string;state:DirectorRuleLiveState}>;

const recent=(at:number,now:number,ttl:number):boolean=>
  Number.isSafeInteger(at) && Number.isSafeInteger(now) &&
  at>0 && now>=at && now-at<=ttl;

export function directorLivePreview(
  settings:Pick<Settings,"musicOnlyMode"|"directorRules">,
  evidence:DirectorEvidence,
  now:number,
):readonly DirectorRuleLiveItem[] {
  const ambient=!settings.musicOnlyMode && evidence.ambient &&
    recent(evidence.ambient.at,now,10_000)?evidence.ambient:null;
  const step=!settings.musicOnlyMode && evidence.step &&
    recent(evidence.step.at,now,4_500) &&
    Number.isFinite(evidence.step.bpm) && evidence.step.bpm>=40 &&
    evidence.step.bpm<=225?evidence.step:null;
  const enabled=new Set(settings.directorRules.filter(x=>x.enabled).map(x=>x.id));
  return DIRECTOR_RULES.map(rule=>{
    const on=enabled.has(rule.id);
    const matched=rule.id==="steps-drums" ? step!==null :
      rule.id==="rain-soft" ? ambient?.atmosphere==="rain" :
      rule.id==="transport-pads" ? ambient?.atmosphere==="traffic" :
      // "Nature" also covers wind/insects. It is NOT proof of birds.
      rule.id==="birds-melody" ? ambient?.atmosphere==="nature" && ambient.birdLabel :
      rule.id==="quiet-sparse" ? ambient?.atmosphere==="quiet" : false;
    return {
      id:rule.id,trigger:rule.trigger,effect:rule.effect,
      state:!on?"off":matched?"detected":"waiting",
    };
  });
}
