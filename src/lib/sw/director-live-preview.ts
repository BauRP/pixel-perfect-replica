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
    evidence.step.bpm<=300?evidence.step:null;
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

/** Two separate, genuine YAMNet bird windows are required.
 * Generic nature (wind/insects) must never trigger the birds rule.
 * No microphone access and no persistent storage. */
export class BirdEvidenceGate {
  private lastBirdAt=0;
  private confirmedAt=0;
  ingest(label:unknown,confidence:unknown,timestamp:unknown):boolean {
    if(typeof label!=="string"||typeof confidence!=="number"||
       !Number.isFinite(confidence)||confidence<.53||confidence>1||
       typeof timestamp!=="number"||!Number.isSafeInteger(timestamp)||timestamp<=0)return false;
    const bird=/\b(?:bird|birds|birdsong|chirping)\b/i.test(label);
    // Each inference window can contain several unrelated top-5 labels.
    // A car/wind label arriving before the next bird label must not erase
    // genuine bird evidence; the 3.5s maximum gap limits continuity.
    if(!bird)return false;
    if(this.lastBirdAt>0 && timestamp<=this.lastBirdAt)return false;
    const repeated=this.lastBirdAt>0 &&
      timestamp-this.lastBirdAt>=650 && timestamp-this.lastBirdAt<=3500;
    this.lastBirdAt=timestamp;
    if(repeated){this.confirmedAt=timestamp;return true;}
    return false;
  }
  isRecent(now:number):boolean {
    return this.confirmedAt>0&&Number.isSafeInteger(now)&&
      now>=this.confirmedAt&&now-this.confirmedAt<=10000;
  }
  reset():void {this.lastBirdAt=0;this.confirmedAt=0;}
}
