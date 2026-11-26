import {getAdapters,type ClipMeta,type Unsubscribe} from "./engine";
import {getSettingsSnapshot,subscribeSettings} from "./settings";
import {SerialNativeOperations} from "./serial-native-operations";
import {MusicControlPlanner} from "./music-control";
import type {Atmosphere} from "./environment-smoothing";
import type {LiveMusicRequestInputs} from "./adaptive-midi-source";

const known=new Set<Atmosphere>(["rain","traffic","nature","indoor","quiet"]);
const birdClass=/\b(?:bird|birds|birdsong|chirp|chirping|tweet)\b/i;

/** Explicit music session owns the subscriptions. Does not request permission,
 * open a microphone until startCapture is explicitly called after Play and
 * package checks, or fabricate pace. Ordinary sensor events update the next
 * composition, never invalidate an already running model invocation. */
export function createLiveFermataInputs(favorites:()=>ClipMeta[]):{
  inputs:LiveMusicRequestInputs;close:()=>void;startCapture:()=>Promise<void>;stopCapture:()=>Promise<void>;
}{
  const adapters=getAdapters();
  const planner=new MusicControlPlanner();
  const cleanup:Unsubscribe[]=[];
  let closed=false,revision=0,lastBird=0;
  const lifecycle=new SerialNativeOperations();
  let requested=false,ownsMic=false,ownsSteps=false;
  const visible=()=>typeof document==="undefined"||document.visibilityState!=="hidden";
  let lastRoute=getSettingsSnapshot().microphonePreference;
  let lastAuto=getSettingsSnapshot().autoAudioRouting;
  const stopOwned=async()=>{
    // Retain ownership after an unconfirmed stop so the next reconcile
    // can retry and will not mistakenly reopen that capture.
    const [mic,steps]=await Promise.all([
      ownsMic?adapters.environment.stopCapture().catch(()=>null):Promise.resolve(null),
      ownsSteps?adapters.activity.stopCapture?.().catch(()=>null):Promise.resolve(null),
    ]);
    if(mic?.ok)ownsMic=false;
    if(steps?.ok)ownsSteps=false;
    planner.reset();lastBird=0;
  };
  const reconcile=()=>lifecycle.enqueue(async()=>{
    const allowed=()=>requested&&!closed&&visible()&&!getSettingsSnapshot().musicOnlyMode;
    if(!allowed()){
      await stopOwned();
      return;
    }
    if(!ownsMic){
      const result=await adapters.environment.startCapture().catch(()=>null);
      ownsMic=result?.ok===true;
    }
    if(allowed()&&!ownsSteps&&adapters.activity.startCapture){
      const result=await adapters.activity.startCapture().catch(()=>null);
      ownsSteps=result?.ok===true;
    }
    if(!allowed()){
      await stopOwned();
    }
  });
  const startCapture=()=>{requested=true;return reconcile();};
  const stopCapture=()=>{requested=false;return reconcile();};
  const close=()=>{
    if(closed)return;
    closed=true;
    void stopCapture().catch(()=>undefined);
    for(const unsub of cleanup.splice(0).reverse()){try{unsub();}catch{/* release others */}}
    planner.reset();
  };
  try{
    if(typeof document!=="undefined"){
      const onVisibility=()=>{
        if(!visible()){
          planner.reset();lastBird=0;
          void lifecycle.enqueue(stopOwned).catch(()=>undefined);
        }else if(requested)void reconcile().catch(()=>undefined);
      };
      document.addEventListener("visibilitychange",onVisibility);
      cleanup.push(()=>document.removeEventListener("visibilitychange",onVisibility));
    }
    cleanup.push(subscribeSettings(()=>{
      if(closed)return;
      revision++;
      const settings=getSettingsSnapshot();
      if(settings.musicOnlyMode){planner.reset();lastBird=0;}
      if(requested){
        void reconcile().catch(()=>undefined);
        if(visible()&&!settings.musicOnlyMode&&ownsMic&&
           (lastRoute!==settings.microphonePreference||lastAuto!==settings.autoAudioRouting))
          void adapters.router.chooseBestSupportedRoute().catch(()=>undefined);
      }
      lastRoute=settings.microphonePreference;lastAuto=settings.autoAudioRouting;
    }));
    cleanup.push(adapters.router.observeInputOutputChanges(()=>{
      if(!closed){planner.invalidateAmbient();lastBird=0;}
    }));
    cleanup.push(adapters.environment.observeEnvironment(e=>{
      if(closed||!requested||!visible()||!ownsMic)return;
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
      if(closed||!requested||!visible()||!ownsSteps||getSettingsSnapshot().musicOnlyMode||
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
    revision:()=>revision},close,startCapture,stopCapture};
}
