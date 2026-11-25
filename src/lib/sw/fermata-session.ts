import type { Settings } from "./settings";
import type { FermataHeader } from "./fermata-conditioning";
import { AdaptiveMidiSource, type LiveMusicRequestInputs } from "./adaptive-midi-source";
import { generateNativeFermataTokens, createNativeSonivoxRenderer, inspectFermataPackage } from "./fermata-native";
import { renderContinuousVerifiedMidiToPcm } from "./verified-midi-pcm-bridge";
import type { SequenceOptions, SequenceOutcome } from "./continuous-midi-scores";
import { createNativeGeneratedPcmSession } from "./generated-pcm-session";
import { requestNativeAudioSink, stopNativeAudioSink, drainNativeAudioSink } from "./native-pcm";

/** Integration point for the actual original codec, NOT an implemented codec.
 * Only called from an explicitly authorized Play after package and decoder
 * verification. No automatic activation, network, or fabricated notes. */
export interface OriginalFermataDecoder {
  decode(tokens:readonly string[], header:Readonly<FermataHeader>):Promise<unknown>;
}

let active=false;
export async function runNativeFermataSession(
  settings:Settings,genres:string[],inputs:LiveMusicRequestInputs,
  decoder:OriginalFermataDecoder,options:SequenceOptions={},
):Promise<SequenceOutcome> {
  if(active||options.signal?.aborted||options.isCancelled?.())
    return {ok:false,code:"UNAVAILABLE",message:"Музыкальный сеанс уже занят или остановлен",completedScores:0,totalFrames:0};
  active=true;
  const session=createNativeGeneratedPcmSession(settings,genres);
  let opened=false;
  try{
    const packageState=await inspectFermataPackage();
    if(!packageState?.packageComplete||!packageState.arm64Supported)
      return {ok:false,code:"UNAVAILABLE",message:"Полный локальный музыкальный пакет отсутствует",completedScores:0,totalFrames:0};
    const source=new AdaptiveMidiSource({
      generate:async(_request,signal,header)=>{
        if(signal.aborted)throw new Error("Генерация остановлена");
        const tokens=await generateNativeFermataTokens(header,4096-header.tokens.length);
        if(signal.aborted)throw new Error("Генерация остановлена");
        return decoder.decode(tokens,header);
      },
    },inputs,options.maxScoreWaitMs??120_000);
    const renderer=createNativeSonivoxRenderer();
    // Do not start a foreground audio service while the first composition
    // is still being generated. Start only when genuine PCM is ready.
    const result=await renderContinuousVerifiedMidiToPcm(source,renderer,{
      submit:async(bytes)=>{
        if(options.signal?.aborted||options.isCancelled?.())
          return {ok:false,code:"UNAVAILABLE",message:"Музыка остановлена"};
        if(!opened){
          const ready=await requestNativeAudioSink();
          if(!ready.ok)return ready;
          opened=true;
          if(options.signal?.aborted||options.isCancelled?.()){
            await stopNativeAudioSink();
            return {ok:false,code:"UNAVAILABLE",message:"Музыка остановлена"};
          }
        }
        return session.submit(bytes);
      },
      stop:()=>session.stop(),
    },options);
    if(result.ok&&opened){
      const drained=await drainNativeAudioSink(result.totalFrames,
        ()=>options.signal?.aborted===true||options.isCancelled?.()===true);
      if(!drained.ok)return {ok:false,code:drained.code==="UNAVAILABLE"?"UNAVAILABLE":"ERROR",
        message:drained.message,completedScores:result.completedScores,totalFrames:result.totalFrames};
      const stopped=await session.stop();
      if(!stopped.ok)return {ok:false,code:"ERROR",message:stopped.message,
        completedScores:result.completedScores,totalFrames:result.totalFrames};
    }
    return result;
  }finally{
    try{if(opened)await session.stop();}finally{active=false;}
  }
}
