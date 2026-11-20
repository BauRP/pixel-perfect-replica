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
}>;
type Fetched={kind:"score";value:unknown|null}|{kind:"failure";message:string}|{kind:"cancelled"};

function cancelled(options?:SequenceOptions):boolean {
  return options?.signal?.aborted===true||options?.isCancelled?.()===true;
}
function fetchScore(source:RealScoreSource,options?:SequenceOptions):Promise<Fetched>{
  if(cancelled(options))return Promise.resolve({kind:"cancelled"});
  try {
    const requested=Promise.resolve(source.next(options?.signal)).then(
      (value):Fetched=>({kind:"score",value}),
      (e):Fetched=>({kind:"failure",message:e instanceof Error?e.message:"Ошибка получения MIDI"}),
    );
    const signal=options?.signal;
    if(!signal)return requested;
    return new Promise<Fetched>(resolve=>{
      const abort=()=>{signal.removeEventListener("abort",abort);resolve({kind:"cancelled"});};
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted)abort();
      void requested.then(value=>{signal.removeEventListener("abort",abort);resolve(value);});
    });
  }catch(e){
    return Promise.resolve({kind:"failure",message:e instanceof Error?e.message:"Ошибка генератора MIDI"});
  }
}

/** renderOne must validate the score and render only genuine licensed PCM. */
export async function streamRealMidiScores(
  source:RealScoreSource,
  renderOne:(score:unknown,onProgress:(p:RenderProgress)=>void)=>Promise<RenderOutcome>,
  options?:SequenceOptions,
):Promise<SequenceOutcome> {
  const maxScores=options?.maxScores??10_000;
  const lead=options?.prefetchLeadFrames??12*48000;
  if(!Number.isSafeInteger(maxScores)||maxScores<1||maxScores>10_000||
     !Number.isSafeInteger(lead)||lead<0||lead>120*48000)
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
    let renderResult:RenderOutcome;
    try{
      renderResult=await renderOne(score,p=>{
        if(!Number.isSafeInteger(p.renderedFrames)||!Number.isSafeInteger(p.totalFrames)||
           p.renderedFrames<lastFrame||p.renderedFrames>p.totalFrames||
           p.totalFrames<1||(lastTotal!==0&&p.totalFrames!==lastTotal))
          throw new Error("Синтезатор сообщил неверное продвижение по MIDI");
        lastFrame=p.renderedFrames;lastTotal=p.totalFrames;
        options?.onProgress?.({completedScores,totalRenderedFrames:totalFrames+p.renderedFrames,
          currentScoreFrames:p.renderedFrames,currentScoreTotalFrames:p.totalFrames});
        if(!prefetched&&completedScores+1<maxScores&&
           p.totalFrames-p.renderedFrames<=lead&&!cancelled(options))
          prefetched=fetchScore(source,options);
      });
    }catch(e){return fail("ERROR",e instanceof Error?e.message:"Ошибка потока MIDI");}
    if(cancelled(options))return fail("UNAVAILABLE","Музыкальный поток остановлен");
    if(!renderResult.ok)return fail(renderResult.code,renderResult.message);
    if(!Number.isSafeInteger(renderResult.frames)||renderResult.frames<1||
       (lastTotal>0&&(lastFrame!==lastTotal||lastTotal!==renderResult.frames)))
      return fail("ERROR","Подтверждена неверная длительность музыкального фрагмента");
    totalFrames+=renderResult.frames;completedScores++;
    if(completedScores>=maxScores)return {ok:true,completedScores,totalFrames};
    next=await (prefetched??fetchScore(source,options));
  }
  return {ok:true,completedScores,totalFrames};
}
