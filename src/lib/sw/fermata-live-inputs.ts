import {getAdapters,type ClipMeta,type Unsubscribe} from "./engine";
import {getSettingsSnapshot,subscribeSettings} from "./settings";
import {MusicControlPlanner} from "./music-control";
import type {Atmosphere} from "./environment-smoothing";
import type {LiveMusicRequestInputs} from "./adaptive-midi-source";

const known=new Set<Atmosphere>(["rain","traffic","nature","indoor","quiet"]);
const birdClass=/\b(?:bird|birds|birdsong|chirp|chirping|tweet)\b/i;

/** Explicit music session owns the subscriptions. Does not request permission,
 * open a microphone or fabricate pace. Ordinary sensor events update the next
 * composition, never invalidate an already running model invocation. */
export function createLiveFermataInputs(favorites:()=>ClipMeta[]):{
  inputs:LiveMusicRequestInputs;close:()=>void;
}{
  const adapters=getAdapters();
  const planner=new MusicControlPlanner();
  const cleanup:Unsubscribe[]=[];
  let closed=false,revision=0,lastBird=0;
  const close=()=>{
    if(closed)return;
    closed=true;
    for(const unsub of cleanup.splice(0).reverse()){try{unsub();}catch{/* release others */}}
    planner.reset();
  };
  try{
    cleanup.push(subscribeSettings(()=>{
      if(closed)return;
      revision++;
      if(getSettingsSnapshot().musicOnlyMode){planner.reset();lastBird=0;}
    }));
    cleanup.push(adapters.router.observeInputOutputChanges(()=>{
      if(!closed){planner.invalidateAmbient();lastBird=0;}
    }));
    cleanup.push(adapters.environment.observeEnvironment(e=>{
      if(closed)return;
      const settings=getSettingsSnapshot();
      const age=Date.now()-e.timestamp;
      if(settings.musicOnlyMode||!Number.isSafeInteger(e.timestamp)||age<0||age>12000||
         !known.has(e.label as Atmosphere))return;
      planner.observeAmbient({atmosphere:e.label as Atmosphere,confidence:e.confidence,timestamp:e.timestamp},settings);
      if(e.label==="nature"&&typeof e.rawLabel==="string"&&birdClass.test(e.rawLabel)&&
         Number.isFinite(e.confidence)&&e.confidence>=.65&&e.confidence<=1){
        if(lastBird>0&&e.timestamp-lastBird>=650&&e.timestamp-lastBird<=10000)
          planner.observeConfirmedBird(e.timestamp);
        lastBird=e.timestamp;
      }else lastBird=0;
    }));
    cleanup.push(adapters.activity.observeWalkingRunningTransportRest(e=>{
      if(closed||getSettingsSnapshot().musicOnlyMode||
         (e.activity!=="walking"&&e.activity!=="running")||
         typeof e.bpm!=="number"||typeof e.timestamp!=="number")return;
      const age=Date.now()-e.timestamp;
      if(age<0||age>4500)return;
      planner.observePace({bpm:e.bpm,confidence:e.confidence,timestamp:e.timestamp});
    }));
  }catch(error){close();throw error;}
  return {inputs:{currentSettings:getSettingsSnapshot,
    currentPlan:()=>planner.plan(getSettingsSnapshot(),Date.now()),
    currentFavorites:()=>favorites().slice(),
    revision:()=>revision},close};
}
