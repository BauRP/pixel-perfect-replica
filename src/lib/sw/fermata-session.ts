import type { Settings } from "./settings";
import type { ClipMeta } from "./engine";
import { createLiveFermataInputs } from "./fermata-live-inputs";
import type { FermataHeader } from "./fermata-conditioning";
import { AdaptiveMidiSource, type LiveMusicRequestInputs } from "./adaptive-midi-source";
import { generateNativeFermataTokens, createNativeSonivoxRenderer, inspectFermataPackage } from "./fermata-native";
import { renderContinuousVerifiedMidiToPcm } from "./verified-midi-pcm-bridge";
import type { SequenceOptions, SequenceOutcome } from "./continuous-midi-scores";
import { createNativeGeneratedPcmSession } from "./generated-pcm-session";
import { requestNativeAudioSink, stopNativeAudioSink, drainNativeAudioSink, currentAudioSinkStatus } from "./native-pcm";

/** Integration point for the actual original codec, NOT an implemented codec.
 * Only called from an explicitly authorized Play after package and decoder
 * verification. No automatic activation, network, or fabricated notes. */
export interface OriginalFermataDecoder {
  decode(tokens:readonly string[], header:Readonly<FermataHeader>):Promise<unknown>;
}

let active=false;
let liveWrapperActive=false;
export async function runNativeFermataSession(
  settings:Settings,genres:string[],inputs:LiveMusicRequestInputs,
  decoder:OriginalFermataDecoder,options:SequenceOptions={},
  onPrepared?:()=>Promise<void>,
):Promise<SequenceOutcome> {
  if(active||options.signal?.aborted||options.isCancelled?.())
    return {ok:false,code:"UNAVAILABLE",message:"Музыкальный сеанс уже занят или остановлен",completedScores:0,totalFrames:0};
  active=true;
  const session=createNativeGeneratedPcmSession(settings,genres);
  let opened=false;
  let monitor:ReturnType<typeof setInterval>|undefined;
  let checking=false,missed=0;
  let interrupted=false;
  const externalCancelled=options.isCancelled;
  const cancelled=()=>interrupted||options.signal?.aborted===true||externalCancelled?.()===true;
  const sessionOptions:SequenceOptions={...options,isCancelled:cancelled};
  try{
    const packageState=await inspectFermataPackage();
    if(!packageState?.packageComplete||!packageState.arm64Supported)
      return {ok:false,code:"UNAVAILABLE",message:"Полный локальный музыкальный пакет отсутствует",completedScores:0,totalFrames:0};
    if(onPrepared&&!cancelled())await onPrepared();
    if(cancelled())return {ok:false,code:"UNAVAILABLE",message:"Музыка остановлена",completedScores:0,totalFrames:0};
    const source=new AdaptiveMidiSource({
      generate:async(request,signal,header)=>{
        if(signal.aborted)throw new Error("Генерация остановлена");
        const tokens=await generateNativeFermataTokens(header,4096-header.tokens.length,request.diversity,signal);
        if(signal.aborted)throw new Error("Генерация остановлена");
        return decoder.decode(tokens,header);
      },
    },inputs,options.maxScoreWaitMs??120_000);
    const renderer=createNativeSonivoxRenderer();
    // Do not start a foreground audio service while the first composition
    // is still being generated. Start only when genuine PCM is ready.
    const result=await renderContinuousVerifiedMidiToPcm(source,renderer,{
      submit:async(bytes)=>{
        if(cancelled())
          return {ok:false,code:"UNAVAILABLE",message:"Музыка остановлена"};
        if(!opened){
          const ready=await requestNativeAudioSink();
          if(!ready.ok)return ready;
          opened=true;
          // Once sound is active, native focus loss/headphone disconnect
          // must cancel the producer even during a long model calculation.
          monitor=setInterval(()=>{
            if(checking||interrupted)return;
            checking=true;
            void currentAudioSinkStatus().then(status=>{
              if(!status){if(++missed>=2)interrupted=true;return;}
              missed=0;
              if(!status.serviceActive||!status.readyForPcm||status.lastAudioError)interrupted=true;
            }).finally(()=>{checking=false;});
          },1000);
          if(cancelled()){
            await stopNativeAudioSink();
            return {ok:false,code:"UNAVAILABLE",message:"Музыка остановлена"};
          }
        }
        return session.submit(bytes);
      },
      stop:()=>session.stop(),
    },sessionOptions);
    if(result.ok&&opened){
      const drained=await drainNativeAudioSink(result.totalFrames,
        cancelled);
      if(!drained.ok)return {ok:false,code:drained.code==="UNAVAILABLE"?"UNAVAILABLE":"ERROR",
        message:drained.message,completedScores:result.completedScores,totalFrames:result.totalFrames};
      const stopped=await session.stop();
      if(!stopped.ok)return {ok:false,code:"ERROR",message:stopped.message,
        completedScores:result.completedScores,totalFrames:result.totalFrames};
    }
    return result;
  }finally{
    if(monitor!==undefined)clearInterval(monitor);
    try{if(opened)await session.stop();}finally{active=false;}
  }
}

/** Explicit Play entry for a future verified production decoder. Capture
 * starts only after the complete local package is confirmed and only with
 * permissions already granted; no surprise permission dialog. */
export async function runFermataWithLiveInputs(settings:Settings,genres:string[],
  favorites:()=>ClipMeta[],decoder:OriginalFermataDecoder,options:SequenceOptions={}):Promise<SequenceOutcome>{
  if(liveWrapperActive||active)
    return {ok:false,code:"UNAVAILABLE",message:"Музыкальный сеанс уже занят",completedScores:0,totalFrames:0};
  liveWrapperActive=true;
  let live:ReturnType<typeof createLiveFermataInputs>|undefined;
  try{
    live=createLiveFermataInputs(favorites);
    return await runNativeFermataSession(settings,genres,live.inputs,decoder,options,live.startCapture);
  }finally{
    try{
      if(live){await live.stopCapture();live.close();}
    }finally{liveWrapperActive=false;}
  }
}
