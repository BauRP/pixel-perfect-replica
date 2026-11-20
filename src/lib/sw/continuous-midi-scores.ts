/**
 * Bounded real-score-only sequence driver for a genuinely licensed generator.
 * This file creates no MIDI notes, placeholder music or synthetic audio.
 * At most one future score is fetched; multi-hour sessions retain no history.
 */
import type { RenderOutcome, RenderProgress } from "./verified-midi-pcm-bridge";

export interface RealScoreSource {
  next(signal?:AbortSignal):Promise<unknown|null>; // null = deliberate end
}
export type SequenceProgress=Readonly<{
  completedScores:number;
  totalRenderedFrames:number;
  currentScoreFrames:number;
  currentScoreTotalFrames:number;
}>;
export type SequenceOutcome=
  | {ok:true;completedScores:number;totalFrames:number}
  | {ok:false;code:"ERROR"|"UNAVAILABLE";message:string;completedScores:number;totalFrames:number};
export type SequenceOptions=Readonly<{
  signal?:AbortSignal;
  isCancelled?:()=>boolean;
  onProgress?:(progress:SequenceProgress)=>void;
  prefetchLeadFrames?:number;
  maxScores?:number;
  /** Timeout for a genuine on-device model call, including prefetch. */
  maxScoreWaitMs?:number;
}>;
type Fetched={kind:"score";value:unknown|null}|{kind:"failure";message:string}|{kind:"cancelled"};

function cancelled(options?:SequenceOptions):boolean {
  return options?.signal?.aborted===true||options?.isCancelled?.()===true;
}
/** Every local model call is bounded even if the native inference engine
 * never resolves or ignores AbortSignal. Never substitute fake notes. */
function fetchScore(source:RealScoreSource,options?:SequenceOptions,prefetchAbort?:AbortSignal):Promise<Fetched>{
  const deadlineMs=options?.maxScoreWaitMs??120_000;
  return new Promise<Fetched>(resolve=>{
    const controller=new AbortController();
    let finished=false;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let polling:ReturnType<typeof setInterval>|undefined;
    const finish=(result:Fetched)=>{
      if(finished)return;
      finished=true;
      if(timeout!==undefined)clearTimeout(timeout);
      if(polling!==undefined)clearInterval(polling);
      options?.signal?.removeEventListener("abort",onAbort);
      prefetchAbort?.removeEventListener("abort",onAbort);
      if(result.kind!=="score")controller.abort();
      resolve(result);
    };
    const onAbort=()=>finish({kind:"cancelled"});
    if(cancelled(options)||prefetchAbort?.aborted===true){finish({kind:"cancelled"});return;}
    options?.signal?.addEventListener("abort",onAbort,{once:true});
    prefetchAbort?.addEventListener("abort",onAbort,{once:true});
    timeout=setTimeout(()=>finish({kind:"failure",message:"Модель не ответила за установленное время"}),deadlineMs);
    if(options?.isCancelled)polling=setInterval(()=>{if(cancelled(options))onAbort();},100);
    void Promise.resolve().then(()=>{
      if(finished)return null;
      return source.next(controller.signal);
    }).then(
      value=>{if(!finished)finish({kind:"score",value});},
      error=>finish({kind:"failure",message:error instanceof Error?error.message:"Ошибка получения MIDI"}),
    );
  });
}

/** renderOne must validate the score and render only genuine licensed PCM. */
export async function streamRealMidiScores(
  source:RealScoreSource,
  renderOne:(score:unknown,onProgress:(p:RenderProgress)=>void)=>Promise<RenderOutcome>,
  options?:SequenceOptions,
):Promise<SequenceOutcome> {
  const maxScores=options?.maxScores??10_000;
  const lead=options?.prefetchLeadFrames??12*48000;
  const maxWait=options?.maxScoreWaitMs??120_000;
  if(!Number.isSafeInteger(maxScores)||maxScores<1||maxScores>10_000||
     !Number.isSafeInteger(lead)||lead<0||lead>120*48000||
     !Number.isSafeInteger(maxWait)||maxWait<1000||maxWait>300_000)
    return {ok:false,code:"ERROR",message:"Неверные ограничения музыкального потока",completedScores:0,totalFrames:0};
  let totalFrames=0,completedScores=0;
  let next=await fetchScore(source,options);
  const fail=(code:"ERROR"|"UNAVAILABLE",message:string):SequenceOutcome=>
    ({ok:false,code,message,completedScores,totalFrames});
  while(completedScores<maxScores){
    if(cancelled(options)||next.kind==="cancelled")return fail("UNAVAILABLE","Музыкальный поток остановлен");
    if(next.kind==="failure")return fail("ERROR",next.message);
    if(next.value===null)return completedScores>0?{ok:true,completedScores,totalFrames}:
      fail("UNAVAILABLE","Генератор не предоставил настоящую композицию");
    const score=next.value;
    let prefetched:Promise<Fetched>|null=null,lastFrame=0,lastTotal=0;
    let prefetchAbort:AbortController|null=null;
    let progressOpen=true;
    const cancelUnusedPrefetch=()=>{
      progressOpen=false;
      prefetchAbort?.abort();
    };
    let renderResult:RenderOutcome;
    try{
      renderResult=await renderOne(score,p=>{
        if(!progressOpen)throw new Error("Позднее событие завершённого MIDI-рендера");
        if(!Number.isSafeInteger(p.renderedFrames)||!Number.isSafeInteger(p.totalFrames)||
           p.renderedFrames<lastFrame||p.renderedFrames>p.totalFrames||
           p.totalFrames<1||(lastTotal!==0&&p.totalFrames!==lastTotal))
          throw new Error("Синтезатор сообщил неверное продвижение по MIDI");
        lastFrame=p.renderedFrames;lastTotal=p.totalFrames;
        options?.onProgress?.({completedScores,totalRenderedFrames:totalFrames+p.renderedFrames,
          currentScoreFrames:p.renderedFrames,currentScoreTotalFrames:p.totalFrames});
        if(!prefetched&&completedScores+1<maxScores&&
           p.totalFrames-p.renderedFrames<=lead&&!cancelled(options)){
          prefetchAbort=new AbortController();
          prefetched=fetchScore(source,options,prefetchAbort.signal);
        }
      });
    }catch(e){
      cancelUnusedPrefetch();
      return fail("ERROR",e instanceof Error?e.message:"Ошибка потока MIDI");
    }
    progressOpen=false;
    if(cancelled(options)){
      cancelUnusedPrefetch();
      return fail("UNAVAILABLE","Музыкальный поток остановлен");
    }
    if(!renderResult.ok){
      cancelUnusedPrefetch();
      return fail(renderResult.code,renderResult.message);
    }
    if(!Number.isSafeInteger(renderResult.frames)||renderResult.frames<1||
       (lastTotal>0&&(lastFrame!==lastTotal||lastTotal!==renderResult.frames))){
      cancelUnusedPrefetch();
      return fail("ERROR","Подтверждена неверная длительность музыкального фрагмента");
    }
    totalFrames+=renderResult.frames;completedScores++;
    if(completedScores>=maxScores){
      cancelUnusedPrefetch();
      return {ok:true,completedScores,totalFrames};
    }
    next=await (prefetched??fetchScore(source,options));
  }
  return {ok:true,completedScores,totalFrames};
}
