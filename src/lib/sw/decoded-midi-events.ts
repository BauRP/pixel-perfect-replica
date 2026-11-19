/**
 * Symbolic-score -> timestamped MIDI-event boundary for a FUTURE licensed
 * synthesizer. This does not compose music, convert Fermata tokens or render
 * PCM. All input notes must have already passed the real decoded score gate.
 *
 * Integer microseconds preserve deterministic timing across long sessions.
 * Same-timestamp note-offs run BEFORE note-ons to avoid accidentally cutting
 * a repeated pitch; stable ordering preserves track voices.
 */
import { validateDecodedMidiScore } from "./decoded-midi-score";

export type MidiScheduledEvent = Readonly<{
  atUs:number;
  kind:"noteOn"|"noteOff";
  track:number;
  channel:number;
  pitch:number;
  velocity:number;
  program:number;
}>;

export type MidiScheduleResult =
  | {ok:true; durationUs:number; events:readonly MidiScheduledEvent[]}
  | {ok:false; reason:string};

export function scheduleDecodedMidiNotes(score:unknown):MidiScheduleResult {
  const checked=validateDecodedMidiScore(score);
  if(!checked.ok)return {ok:false,reason:checked.reason};
  const entries:{event:MidiScheduledEvent;order:number}[]=[];
  checked.value.notes.forEach((note,index)=>{
    entries.push({
      event:{atUs:note.startUs,kind:"noteOn",track:note.track,channel:note.channel,
        pitch:note.pitch,velocity:note.velocity,program:note.program},
      order:index,
    },{
      event:{atUs:note.endUs,kind:"noteOff",track:note.track,channel:note.channel,
        pitch:note.pitch,velocity:0,program:note.program},
      order:index,
    });
  });
  entries.sort((a,b)=>a.event.atUs-b.event.atUs ||
    (a.event.kind===b.event.kind?0:a.event.kind==="noteOff"?-1:1) ||
    a.order-b.order);
  const events=entries.map(({event})=>Object.freeze(event));
  return {ok:true,durationUs:checked.value.durationUs,events:Object.freeze(events)};
}

/** Convert absolute integer event time to a native sample offset at 48 kHz.
 * The return value is an INDEX, not evidence that synthesis has happened.
 */
export function midiEventFrame(atUs:number,sampleRate=48000):number|null {
  if(!Number.isSafeInteger(atUs)||atUs<0 ||
     !Number.isSafeInteger(sampleRate)||sampleRate<1||sampleRate>192000)return null;
  const frames=Math.round(atUs*sampleRate/1_000_000);
  return Number.isSafeInteger(frames)?frames:null;
}
