/**
 * Android AudioTrack sink for GENUINE locally generated PCM buffers.
 * NOT a music generator; callers must provide actual 48kHz, stereo 16-bit PCM.
 * The existing MusicEngine remains UNAVAILABLE until the approved Fermata
 * model and a genuine licensed synthesizer stream real samples.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Result } from "./engine";
import { pcmToBase64 } from "./pcm-base64";
import { SerialNativeOperations } from "./serial-native-operations";

interface PCMPlugin {
  start(): Promise<{preparing:boolean}>;
  appendPcm(args:{base64:string;sessionId:number}): Promise<{queued:boolean;backpressure?:boolean}>;
  pause(): Promise<{audible:boolean}>;
  stop(): Promise<{requested:boolean}>;
  status(): Promise<{audible:boolean;queuedChunks:number;serviceActive:boolean;readyForPcm:boolean;sessionId:number;underruns:number;lastAudioError:string}>;
}
const native = registerPlugin<PCMPlugin>("SoundWorldPlayback");
// A process-wide PCM bridge is allowed to write only to the foreground
// Android session that the user actually started and Android confirmed.
let activeSessionId:number|null = null;
let requestGeneration = 0;
// Serial lifecycle ensures a delayed Android START cannot run after STOP.
const audioLifecycle = new SerialNativeOperations();
// Independent ordered PCM packets: concurrent producers must never reorder notes.
const pcmWriteQueue = new SerialNativeOperations();
const MAX_PENDING_PCM_WRITES = 8;
let pendingPcmWrites = 0;
const PCM_ACK_TIMEOUT_MS = 3000;
const AUDIO_NATIVE_CALL_MS = 3500;
class NativeCallTimeout extends Error {}
/** A broken Capacitor callback must not hold the serial audio lifecycle
 * forever. Stop is still requested natively and no PCM is re-authorized. */
async function boundedNativeCall<T>(action:()=>Promise<T>,timeoutMs=AUDIO_NATIVE_CALL_MS):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new NativeCallTimeout("Android не ответил на аудиокоманду")),timeoutMs);
  });
  try{return await Promise.race([Promise.resolve().then(action),deadline]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
export function matchingPcmSession(active:number|null,requested:number):boolean {
  return active !== null && Number.isSafeInteger(requested) &&
    requested > 0 && active === requested;
}
const unavailable = (msg:string):{ok:false;code:"UNAVAILABLE";message:string} => ({ok:false,code:"UNAVAILABLE",message:msg});
export async function currentAudioSinkStatus() {
  if(Capacitor.getPlatform()!=="android") return null;
  try {return await boundedNativeCall(()=>native.status(),1500);}catch{return null;}
}

/**
 * The caller must start this ONLY after a user-initiated Play action and model validation.
 * It returns PREPARING, not LIVE. Only status().audible confirms AudioTrack writes.
 */
export function requestNativeAudioSink():Promise<Result<"preparing">> {
  if(Capacitor.getPlatform()!=="android") return Promise.resolve(unavailable("Аудиослужба доступна только на Android"));
  const generation = ++requestGeneration;
  activeSessionId=null;
  return audioLifecycle.enqueue(async ():Promise<Result<"preparing">> => {
    if(generation!==requestGeneration)
      return unavailable("Музыкальная сессия уже остановлена");
    try {
    await boundedNativeCall(()=>native.start());
    if(generation!==requestGeneration)
      return unavailable("Музыкальная сессия уже остановлена");
    // ContextCompat.startForegroundService only REQUESTS startup; Android
    // invokes onStartCommand later. Do not send music to an unready service.
    const statusDeadline=Date.now()+4500;
    for(let attempt=0;attempt<24;attempt++) {
      const remaining=statusDeadline-Date.now();
      if(remaining<=0)break;
      const status=await boundedNativeCall(()=>native.status(),Math.min(1200,remaining));
      if(generation!==requestGeneration)
        return unavailable("Музыкальная сессия уже остановлена");
      if(status.readyForPcm && Number.isSafeInteger(status.sessionId) &&
         status.sessionId > 0) {
        activeSessionId=status.sessionId;
        return {ok:true,value:"preparing"};
      }
      if(status.lastAudioError) {
        if(generation===requestGeneration) await boundedNativeCall(()=>native.stop()).catch(()=>{});
        return {ok:false,code:"ERROR",message:status.lastAudioError};
      }
      await new Promise<void>(resolve=>setTimeout(resolve,100));
    }
    // Do not keep an unused foreground service alive if Android never
    // confirms that it is able to accept generated PCM.
    if(generation===requestGeneration) await boundedNativeCall(()=>native.stop()).catch(()=>{});
    return {ok:false,code:"TIMEOUT",message:"Android не подготовил аудиослужбу за 4,5 секунды"};
    } catch(e){
      if(generation===requestGeneration) await boundedNativeCall(()=>native.stop()).catch(()=>{});
      return {ok:false,code:e instanceof NativeCallTimeout?"TIMEOUT":"ERROR",message:String(e)};
    }
  });
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
type QueueReceipt={queued:boolean;backpressure?:boolean};
/** An unknown native acknowledgement must NEVER be retried: Android might
 * already have queued the packet. Cancel the session instead of duplicating sound.
 */
async function boundedPcmReceipt(request:Promise<QueueReceipt>):Promise<QueueReceipt|null> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<null>(resolve=>{
    timer=setTimeout(()=>resolve(null),PCM_ACK_TIMEOUT_MS);
  });
  try{return await Promise.race([request,deadline]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}

export async function appendRealPcm(pcm:Uint8Array):Promise<Result<"queued">> {
  if(Capacitor.getPlatform()!=="android") return unavailable("Аудиовывод Android недоступен");
  if(!validatePcmChunk(pcm))return {ok:false,code:"ERROR",message:"Неверный размер или формат PCM"};
  // Capture session and payload BEFORE waiting; a reusable model buffer may be overwritten.
  const sessionId=activeSessionId;
  if(sessionId===null)return unavailable("Нет подтверждённой музыкальной аудиосессии");
  if(pendingPcmWrites>=MAX_PENDING_PCM_WRITES)
    return unavailable("Очередь настоящего PCM заполнена");
  const encoded=pcmToBase64(pcm);
  pendingPcmWrites++;
  try {
    return await pcmWriteQueue.enqueue(async():Promise<Result<"queued">>=>{
      try {
        // A negative, explicit backpressure is the ONLY retryable outcome.
        for(let attempt=0;attempt<25;attempt++){
          if(!matchingPcmSession(activeSessionId,sessionId))
            return unavailable("Музыкальная сессия сменилась во время передачи PCM");
          const acknowledgment=await boundedPcmReceipt(native.appendPcm({base64:encoded,sessionId}));
          if(!matchingPcmSession(activeSessionId,sessionId))
            return unavailable("Музыкальная сессия остановлена до подтверждения PCM");
          if(acknowledgment===null){
            // A late successful callback is ambiguous. Stop the native session,
            // rather than risking a duplicated packet or a silent frozen writer.
            void stopNativeAudioSink().catch(()=>undefined);
            return {ok:false,code:"TIMEOUT",message:"Android не подтвердил PCM за 3 секунды"};
          }
          if(positivePcmAcknowledgment(acknowledgment))
            return {ok:true,value:"queued"};
          if(!retryablePcmBackpressure(acknowledgment))
            return {ok:false,code:"ERROR",message:"Android не подтвердил приём PCM"};
          if(attempt===24)return {ok:false,code:"TIMEOUT",message:"Очередь настоящего PCM не освободилась"};
          await new Promise<void>(resolve=>setTimeout(resolve,100));
        }
        return {ok:false,code:"TIMEOUT",message:"Очередь PCM недоступна"};
      }catch(e){return {ok:false,code:"ERROR",message:String(e)};}
    });
  }finally{pendingPcmWrites--;}
}
export function pauseNativeAudioSink():Promise<void>{
  // Revoke immediately; the native pause must run AFTER an in-flight START.
  activeSessionId=null;
  requestGeneration++;
  if(Capacitor.getPlatform()!=="android")return Promise.resolve();
  return audioLifecycle.enqueue(async()=>{await boundedNativeCall(()=>native.pause());});
}
export function confirmedAudioStop(response:{requested?:boolean}|null|undefined):boolean {
  return response?.requested === true;
}
export function stopNativeAudioSink():Promise<void>{
  // Invalidate packets now; serialize Android STOP after every pending START.
  activeSessionId=null;
  requestGeneration++;
  if(Capacitor.getPlatform()!=="android")return Promise.resolve();
  return audioLifecycle.enqueue(async()=>{
    const response=await boundedNativeCall(()=>native.stop());
    if(!confirmedAudioStop(response))throw new Error("Android не подтвердил остановку аудиослужбы");
  });
}
