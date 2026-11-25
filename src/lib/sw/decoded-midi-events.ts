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


/** Serialize an authentic decoded score for a MIDI-file-based local synth.
 * Format 0, fixed 1000 ticks/s (500 TPQN at 120 BPM); quantization <=1 ms.
 * Does not invent notes or render audio. One GM program per melodic channel
 * prevents an instrument change from corrupting a different sounding voice.
 */
export function encodeDecodedMidiFile(score:unknown):Uint8Array {
  const scheduled=scheduleDecodedMidiNotes(score);
  if(!scheduled.ok)throw new Error(scheduled.reason);
  const programs=new Map<number,number>();
  const channels=new Map<string,number>();
  const keyOf=(e:MidiScheduledEvent)=>e.channel+":"+e.track+":"+e.program;
  for(const e of scheduled.events) {
    if(e.channel===9||channels.has(keyOf(e)))continue;
    let channel=e.channel;
    if(programs.has(channel)){
      const free=Array.from({length:16},(_,i)=>i).find(i=>i!==9&&!programs.has(i));
      if(free===undefined)throw new Error("Too many independent MIDI voices");
      channel=free;
    }
    channels.set(keyOf(e),channel);
    programs.set(channel,e.program);
  }
  const body:number[]=[0,0xff,0x51,3,0x07,0xa1,0x20];
  for(const [channel,program] of programs)body.push(0,0xc0|channel,program);
  const delta=(value:number)=>{
    if(!Number.isSafeInteger(value)||value<0||value>0x0fffffff)throw new Error("Invalid MIDI delta");
    const bytes=[value&127];
    while((value>>>=7)>0)bytes.unshift((value&127)|128);
    body.push(...bytes);
  };
  let previous=0;
  // Reject sub-millisecond notes when their times collapse on the grid.
  // A score with overlapping equal channel/pitch is ambiguous in GM:
  // reject rather than silently cut or invent a sustained voice.
  const active=new Map<string,number>();
  for(const e of scheduled.events) {
    const tick=Math.round(e.atUs/1000);
    const channel=e.channel===9?9:channels.get(keyOf(e))!;
    const key=channel+":"+e.pitch;
    if(e.kind==="noteOn"){
      if(active.has(key))throw new Error("Overlapping identical MIDI notes");
      active.set(key,tick);
    }else{
      const start=active.get(key);
      if(start===undefined||tick<=start)throw new Error("MIDI note shorter than one tick");
      active.delete(key);
    }
    delta(tick-previous);
    body.push((e.kind==="noteOn"?0x90:0x80)|channel,e.pitch,e.velocity);
    previous=tick;
  }
  delta(Math.round(scheduled.durationUs/1000)-previous);
  body.push(0xff,0x2f,0);
  const bytes=new Uint8Array(22+body.length);
  bytes.set([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,244,0x4d,0x54,0x72,0x6b]);
  new DataView(bytes.buffer).setUint32(18,body.length,false);
  bytes.set(body,22);
  return bytes;
}
