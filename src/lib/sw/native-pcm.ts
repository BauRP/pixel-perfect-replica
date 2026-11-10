/**
 * Android AudioTrack sink for GENUINE locally generated PCM buffers.
 * NOT a music generator; callers must provide actual 48kHz, stereo 16-bit PCM.
 * The existing MusicEngine remains UNAVAILABLE until the approved Fermata
 * model and a genuine licensed synthesizer stream real samples.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Result } from "./engine";

interface PCMPlugin {
  start(): Promise<{preparing:boolean}>;
  appendPcm(args:{base64:string}): Promise<{queued:boolean}>;
  pause(): Promise<{audible:boolean}>;
  stop(): Promise<{requested:boolean}>;
  status(): Promise<{audible:boolean;queuedChunks:number;serviceActive:boolean;underruns:number;lastAudioError:string}>;
}
const native = registerPlugin<PCMPlugin>("SoundWorldPlayback");
const unavailable = (msg:string):{ok:false;code:"UNAVAILABLE";message:string} => ({ok:false,code:"UNAVAILABLE",message:msg});
export async function currentAudioSinkStatus() {
  if(Capacitor.getPlatform()!=="android") return null;
  try {return await native.status();}catch{return null;}
}

/**
 * The caller must start this ONLY after a user-initiated Play action and model validation.
 * It returns PREPARING, not LIVE. Only status().audible confirms AudioTrack writes.
 */
export async function requestNativeAudioSink():Promise<Result<"preparing">> {
  if(Capacitor.getPlatform()!=="android") return unavailable("Аудиослужба доступна только на Android");
  try {await native.start();return {ok:true,value:"preparing"};}
  catch(e){return {ok:false,code:"ERROR",message:String(e)};}
}
export function validatePcmChunk(pcm:Uint8Array):boolean {
  return pcm.length>0 && pcm.length<=192000 && pcm.length%4===0;
}
export async function appendRealPcm(pcm:Uint8Array):Promise<Result<"queued">> {
  if(Capacitor.getPlatform()!=="android") return unavailable("Аудиовывод Android недоступен");
  if(!validatePcmChunk(pcm))return {ok:false,code:"ERROR",message:"Неверный размер или формат PCM"};
  // Chunk <=1s prevents large JS -> native bridge payloads.
  let binary="";
  for(let i=0;i<pcm.length;i++)binary+=String.fromCharCode(pcm[i]!);
  try {
    await native.appendPcm({base64:btoa(binary)});
    return {ok:true,value:"queued"};
  }catch(e){return {ok:false,code:"ERROR",message:String(e)};}
}
export async function pauseNativeAudioSink():Promise<void>{
  if(Capacitor.getPlatform()==="android")await native.pause().catch(()=>{});
}
export async function stopNativeAudioSink():Promise<void>{
  if(Capacitor.getPlatform()==="android")await native.stop();
}
