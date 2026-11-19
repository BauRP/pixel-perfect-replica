/**
 * Android AudioTrack sink for GENUINE locally generated PCM buffers.
 * NOT a music generator; callers must provide actual 48kHz, stereo 16-bit PCM.
 * The existing MusicEngine remains UNAVAILABLE until the approved Fermata
 * model and a genuine licensed synthesizer stream real samples.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Result } from "./engine";
import { pcmToBase64 } from "./pcm-base64";

interface PCMPlugin {
  start(): Promise<{preparing:boolean}>;
  appendPcm(args:{base64:string}): Promise<{queued:boolean;backpressure?:boolean}>;
  pause(): Promise<{audible:boolean}>;
  stop(): Promise<{requested:boolean}>;
  status(): Promise<{audible:boolean;queuedChunks:number;serviceActive:boolean;readyForPcm:boolean;underruns:number;lastAudioError:string}>;
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
  try {
    await native.start();
    // ContextCompat.startForegroundService only REQUESTS startup; Android
    // invokes onStartCommand later. Do not send music to an unready service.
    for(let attempt=0;attempt<24;attempt++) {
      const status=await native.status();
      if(status.readyForPcm) return {ok:true,value:"preparing"};
      if(status.lastAudioError) {
        await native.stop().catch(()=>{});
        return {ok:false,code:"ERROR",message:status.lastAudioError};
      }
      await new Promise<void>(resolve=>setTimeout(resolve,100));
    }
    // Do not keep an unused foreground service alive if Android never
    // confirms that it is able to accept generated PCM.
    await native.stop().catch(()=>{});
    return {ok:false,code:"TIMEOUT",message:"Android не подготовил аудиослужбу за 2,4 секунды"};
  } catch(e){
    await native.stop().catch(()=>{});
    return {ok:false,code:"ERROR",message:String(e)};
  }
}
/** Never count a bridge resolution without affirmative Android queue receipt. */
export function positivePcmAcknowledgment(result:{queued?:boolean}|null|undefined):boolean {
  return result?.queued === true;
}
export function retryablePcmBackpressure(
  result:{queued?:boolean;backpressure?:boolean}|null|undefined,
):boolean {
  return result?.queued === false && result.backpressure === true;
}
export function validatePcmChunk(pcm:Uint8Array):boolean {
  return pcm.length>0 && pcm.length<=192000 && pcm.length%4===0;
}
export async function appendRealPcm(pcm:Uint8Array):Promise<Result<"queued">> {
  if(Capacitor.getPlatform()!=="android") return unavailable("Аудиовывод Android недоступен");
  if(!validatePcmChunk(pcm))return {ok:false,code:"ERROR",message:"Неверный размер или формат PCM"};
  // Chunk <=1s prevents large JS -> native bridge payloads.
  try {
    // A genuine generator can briefly outrun AudioTrack. Only a NEGATIVE
    // queue acknowledgment specifically marked "backpressure" may be
    // retried; successful packets must NEVER be sent twice.
    const encoded=pcmToBase64(pcm);
    for (let attempt=0;attempt<25;attempt++) {
      const acknowledgment=await native.appendPcm({base64:encoded});
      if (positivePcmAcknowledgment(acknowledgment))
        return {ok:true,value:"queued"};
      if (!retryablePcmBackpressure(acknowledgment))
        return {ok:false,code:"ERROR",message:"Android не подтвердил приём PCM"};
      if (attempt===24)
        return {ok:false,code:"TIMEOUT",message:"Очередь настоящего PCM не освободилась"};
      await new Promise<void>(resolve=>setTimeout(resolve,100));
    }
    return {ok:false,code:"TIMEOUT",message:"Очередь PCM недоступна"};
  }catch(e){return {ok:false,code:"ERROR",message:String(e)};}
}
export async function pauseNativeAudioSink():Promise<void>{
  if(Capacitor.getPlatform()==="android")await native.pause().catch(()=>{});
}
export function confirmedAudioStop(response:{requested?:boolean}|null|undefined):boolean {
  return response?.requested === true;
}
export async function stopNativeAudioSink():Promise<void>{
  if(Capacitor.getPlatform()!=="android")return;
  const response=await native.stop();
  if(!confirmedAudioStop(response))throw new Error("Android не подтвердил остановку аудиослужбы");
}
