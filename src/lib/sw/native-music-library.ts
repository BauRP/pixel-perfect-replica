/**
 * Real generated audio files only. The native store receives 48kHz stereo PCM,
 * never copies microphone samples, and never invents a clip before WAV is complete.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { registerAdapters, type Adapters, type ClipMeta, type Result } from "./engine";
import { getSettingsSnapshot, type Settings } from "./settings";
interface LibraryPlugin {
  beginClip(args:{genreIdsJson:string;instrumentIdsJson:string;mood:number;speed:number}):Promise<{id:string}>;
  appendPcm(args:{id:string;base64:string}):Promise<{bytesWritten:number}>;
  finishClip(args:{id:string}):Promise<{clip:ClipMeta}>;
  abortClip(args:{id:string}):Promise<{aborted:boolean}>;
  list(args:{filter:"recent"|"favorites"|"exports"|"journey"}):Promise<{items:ClipMeta[]}>;
  favorite(args:{id:string;value:boolean}):Promise<{updated:boolean}>;
  export(args:{id:string}):Promise<{uri:string}>;
  deleteTemporary(args:{id:string}):Promise<{deleted:boolean}>;
  recover():Promise<{recovered:number}>;
  playClip(args:{id:string;resumeAfterCall:boolean}):Promise<{requested:boolean;id:string}>;
  pauseClip():Promise<{state:string}>;
  stopClip():Promise<{state:string}>;
  playbackStatus():Promise<{state:"playing"|"paused"|"stopped"|"preparing";clipId:string;lastError?:string;actualOutput?:string;actualOutputType?:string}>;
  addListener(event:"clipPlayback",callback:(data:{state:"playing"|"paused"|"stopped"|"preparing";clipId:string;error?:string})=>void):Promise<PluginListenerHandle>;
}
const native=registerPlugin<LibraryPlugin>("SoundWorldMusicLibrary");
const error=(e:unknown):{ok:false;code:"ERROR";message:string}=>({ok:false,code:"ERROR",message:e instanceof Error?e.message:String(e)});
const unavailable=(msg:string):{ok:false;code:"UNAVAILABLE";message:string}=>({ok:false,code:"UNAVAILABLE",message:msg});
export const nativeMusicLibraryAvailable=()=>Capacitor.getPlatform()==="android";
export async function currentStoredPlayback(){
  if(!nativeMusicLibraryAvailable())return null;
  try{return await native.playbackStatus();}catch{return null;}
}
/** Only the approved, genuinely running instrumental model may begin this transaction. */
export async function beginGenuineClip(settings:Settings,genreIds:string[]):Promise<Result<string>> {
  if(!nativeMusicLibraryAvailable())return unavailable("Только Android");
  try {const r=await native.beginClip({mood:settings.mood,speed:settings.speed,genreIdsJson:JSON.stringify(genreIds),instrumentIdsJson:JSON.stringify(settings.favoriteInstrumentIds)});return {ok:true,value:r.id};}
  catch(e){return error(e);}
}
/** PCM belongs to the actual generator output; never pass ambient microphone buffers. */
export async function appendGenuineClipPcm(id:string,pcm:Uint8Array):Promise<Result<number>> {
  if(!nativeMusicLibraryAvailable())return unavailable("Только Android");
  if(!pcm.length || pcm.length%4!==0 || pcm.length>192000)return {ok:false,code:"ERROR",message:"Недопустимый размер PCM"};
  let bin="";for(const value of pcm)bin+=String.fromCharCode(value);
  try {const r=await native.appendPcm({id,base64:btoa(bin)});return {ok:true,value:r.bytesWritten};}
  catch(e){return error(e);}
}
export async function finishGenuineClip(id:string):Promise<Result<ClipMeta>> {
  if(!nativeMusicLibraryAvailable())return unavailable("Только Android");
  try {const r=await native.finishClip({id});return {ok:true,value:r.clip};}
  catch(e){return error(e);}
}
export async function abortGenuineClip(id:string):Promise<void> {
  if(!nativeMusicLibraryAvailable())return;
  try {await native.abortClip({id});} catch { /* already finished / unavailable */ }
}
export function installNativeMusicLibraryAdapter():void {
  if(!nativeMusicLibraryAvailable())return;
  const library:Adapters["library"]={
    listLastThreeCompleted:async()=>{try {const x=await native.list({filter:"recent"});return {ok:true,value:x.items};}catch(e){return error(e);}},
    listFavorites:async()=>{try {const x=await native.list({filter:"favorites"});return {ok:true,value:x.items};}catch(e){return error(e);}},
    listExports:async()=>{try {const x=await native.list({filter:"exports"});return {ok:true,value:x.items};}catch(e){return error(e);}},
    listJourney:async()=>{try {const x=await native.list({filter:"journey"});return {ok:true,value:x.items};}catch(e){return error(e);}},
    markFavorite:async(id,value)=>{try {await native.favorite({id,value});return {ok:true,value:undefined};}catch(e){return error(e);}},
    exportRealAudio:async(id)=>{try {const x=await native.export({id});return {ok:true,value:{uri:x.uri}};}catch(e){return error(e);}},
    deleteTemporary:async(id)=>{try {await native.deleteTemporary({id});return {ok:true,value:undefined};}catch(e){return error(e);}},
    recoverLocalMetadata:async()=>{try {await native.recover();return {ok:true,value:undefined};}catch(e){return error(e);}},
    playStoredClip:async(id)=>{try {await native.playClip({id,resumeAfterCall:getSettingsSnapshot().afterCallAutoResume});return {ok:true,value:undefined};}catch(e){return error(e);}},
    pauseStoredClip:async()=>{try {await native.pauseClip();return {ok:true,value:undefined};}catch(e){return error(e);}},
    stopStoredClip:async()=>{try {await native.stopClip();return {ok:true,value:undefined};}catch(e){return error(e);}},
    observeStoredPlayback:cb=>{
      let closed=false;
      const handle=native.addListener("clipPlayback",e=>{if(!closed)cb(e)});
      return ()=>{closed=true;void handle.then(h=>h.remove()).catch(()=>{});};
    },
  };
  registerAdapters({library});
}
