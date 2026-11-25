/**
 * Bounded bridge from VERIFIED decoded MIDI to a future real, locally bundled
 * Apache-licensed native synthesizer. This class does NOT make sounds and
 * cannot initialize a synth or use an arbitrary ringtone/fake backing track.
 * Exactly one 48 kHz stereo PCM packet is accepted for each rendered range.
 */
import type { MidiScheduledEvent } from "./decoded-midi-events";
import { midiEventFrame, scheduleDecodedMidiNotes } from "./decoded-midi-events";
import { PCM_TRANSFER_BYTES } from "./generated-pcm-session";
import type { Result } from "./engine";
import { streamRealMidiScores, type RealScoreSource, type SequenceOptions, type SequenceOutcome } from "./continuous-midi-scores";

export interface VerifiedMidiRenderer {
  /** Must be backed by an opened, real licensed native soundbank/synth. */
  ready():Promise<boolean>;
  /** Render precisely frameCount genuine stereo PCM frames from actual notes. */
  render(input:{
    readonly fromFrame:number;
    readonly frameCount:number;
    readonly events:readonly MidiScheduledEvent[];
  }):Promise<Uint8Array>;
}
export interface RealPcmConsumer {
  submit(bytes:Uint8Array):Promise<Result<number>>;
  /** Emergency stop for errors/cancelled generation; not after normal playback. */
  stop?():Promise<Result<void>>;
}

export type RenderProgress = Readonly<{renderedFrames:number;totalFrames:number}>;
export type RenderOutcome =
  | {ok:true;frames:number}
  | {ok:false;code:"UNAVAILABLE"|"ERROR";message:string};

const FRAMES_PER_CHUNK=PCM_TRANSFER_BYTES/4; // 250ms, 48k stereo 16-bit
const RATE=48000;
const MIDI_EXTERNAL_DEADLINE_MS=12000;
/** Bounds external native calls; late results are never enqueued after cancel. */
async function awaitMidiExternal<T>(
  action:()=>Promise<T>, isCancelled?:()=>boolean,
):Promise<T> {
  if(isCancelled?.())throw new Error("Рендер музыки остановлен");
  let timer:ReturnType<typeof setTimeout>|undefined;
  let poll:ReturnType<typeof setInterval>|undefined;
  const guard=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error("Синтезатор не ответил вовремя")),MIDI_EXTERNAL_DEADLINE_MS);
    if(isCancelled)poll=setInterval(()=>{
      if(isCancelled())reject(new Error("Рендер музыки остановлен"));
    },100);
  });
  try{return await Promise.race([Promise.resolve().then(action),guard]);}
  finally{
    if(timer!==undefined)clearTimeout(timer);
    if(poll!==undefined)clearInterval(poll);
  }
}

/** A caller may stop at any chunk boundary; no hidden background work. */
export async function renderVerifiedMidiToPcm(
  score:unknown,
  renderer:VerifiedMidiRenderer,
  consumer:RealPcmConsumer,
  options?:{isCancelled?:()=>boolean;onProgress?:(progress:RenderProgress)=>void},
):Promise<RenderOutcome> {
  const schedule=scheduleDecodedMidiNotes(score);
  if(!schedule.ok)return {ok:false,code:"ERROR",message:schedule.reason};
  try {
    if(!(await awaitMidiExternal(()=>renderer.ready(),options?.isCancelled)))
      return {ok:false,code:"UNAVAILABLE",message:"Нет готового настоящего MIDI-синтезатора"};
    const total=midiEventFrame(schedule.durationUs,RATE);
    if(total===null||total<=0)
      return {ok:false,code:"ERROR",message:"Некорректная длительность MIDI"};
    let cursor=0,position=0;
    while(position<total) {
      if(options?.isCancelled?.())
        return {ok:false,code:"UNAVAILABLE",message:"Рендер музыки остановлен"};
      const frameCount=Math.min(FRAMES_PER_CHUNK,total-position);
      const until=position+frameCount;
      const chunkEvents:MidiScheduledEvent[]=[];
      while(cursor<schedule.events.length) {
        const event=schedule.events[cursor]!;
        const frame=midiEventFrame(event.atUs,RATE);
        if(frame===null)return {ok:false,code:"ERROR",message:"Неверный момент MIDI-события"};
        // Note-offs exactly at the END of the final score must still reach
        // the real native synth to release its voices. For intermediate chunk
        // edges, events belong to the following chunk instead.
        if(frame>until || (frame===until && until!==total))break;
        // Exact event time is retained so native synthesis can set sample
        // offsets; no note is duplicated at the next packet boundary.
        chunkEvents.push(event);
        cursor++;
      }
      const pcm=await awaitMidiExternal(
        ()=>renderer.render({fromFrame:position,frameCount,events:chunkEvents}),
        options?.isCancelled,
      );
      if(!(pcm instanceof Uint8Array)||pcm.byteLength!==frameCount*4)
        return {ok:false,code:"ERROR",message:"Синтезатор вернул неполный PCM"};
      if(options?.isCancelled?.())
        return {ok:false,code:"UNAVAILABLE",message:"Рендер музыки остановлен"};
      const accepted=await awaitMidiExternal(()=>consumer.submit(pcm),options?.isCancelled);
      if(!accepted.ok)return {ok:false,code:"ERROR",message:accepted.message};
      if(accepted.value!==pcm.byteLength)
        return {ok:false,code:"ERROR",message:"Передана неполная порция настоящего PCM"};
      position=until;
      options?.onProgress?.({renderedFrames:position,totalFrames:total});
    }
    return {ok:true,frames:total};
  }catch(e){
    const cancelled=options?.isCancelled?.()===true;
    return {ok:false,code:cancelled?"UNAVAILABLE":"ERROR",
      message:e instanceof Error?e.message:"Ошибка MIDI-рендера"};
  }
}

/** Schedule consecutive authentic 60–120s MIDI scores without retaining all
 * of them in memory. This does NOT generate music by itself. */
export async function renderContinuousVerifiedMidiToPcm(
  source:RealScoreSource, renderer:VerifiedMidiRenderer, consumer:RealPcmConsumer,
  options?:SequenceOptions,
):Promise<SequenceOutcome> {
  let finished=false;
  const result=await streamRealMidiScores(source,(score,onProgress)=>
    renderVerifiedMidiToPcm(score,renderer,consumer,{
      isCancelled:()=>finished||options?.signal?.aborted===true||options?.isCancelled?.()===true,
      onProgress,
    }),options);
  finished=true;
  if(!result.ok&&consumer.stop){
    try{await awaitMidiExternal(()=>consumer.stop!());}
    catch{/* Preserve original cause; do not hold Stop forever. */}
  }
  return result;
}
