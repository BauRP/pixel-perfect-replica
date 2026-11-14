/**
 * Validation boundary AFTER a future genuine Fermata tokenizer/REMI+ decoder
 * and BEFORE a licensed MIDI->PCM synthesizer. This is NOT a tokenizer,
 * synthesizer, source of notes, or claim that Fermata runs on Android.
 *
 * Times are INTEGER microseconds to prevent fractional drift over 60-120s
 * clips. Each note carries its GM channel/program and source track.
 * This module does not apply the model-specific percussion workaround:
 * the original tokenizer decoder must implement and test that mapping.
 */
export type DecodedMidiNote = Readonly<{
  track: number;
  channel: number;
  program: number;
  pitch: number;
  velocity: number;
  startUs: number;
  endUs: number;
}>;

export type DecodedMidiScore = Readonly<{
  durationUs: number;
  notes: readonly DecodedMidiNote[];
}>;

export type ScoreCheck =
  | {ok: true; value: DecodedMidiScore}
  | {ok: false; reason: string};

const MIN_US = 60_000_000;
const MAX_US = 120_000_000;
const MAX_NOTES = 50_000;
// Conservative *symbolic* continuity gate: notes cannot leave an invented
// minute of empty timeline while claiming a 120s finished composition.
// This does not replace acoustic testing after real MIDI synthesis.
const MAX_INTERNAL_REST_US = 8_000_000;
const MAX_EDGE_REST_US = 2_000_000;

const inRange = (value: unknown, from: number, through: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) &&
  value >= from && value <= through;

export function validateDecodedMidiScore(input: unknown): ScoreCheck {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return {ok:false,reason:"Missing symbolic score"};
  const raw = input as {durationUs?:unknown;notes?:unknown};
  if (!inRange(raw.durationUs, MIN_US, MAX_US))
    return {ok:false,reason:"Score must span 60-120 seconds"};
  if (!Array.isArray(raw.notes) || raw.notes.length < 1 || raw.notes.length > MAX_NOTES)
    return {ok:false,reason:"Invalid or unbounded note count"};

  const verified: DecodedMidiNote[] = [];
  let previousStart = -1;
  let soundingUntil = 0;
  for (const entry of raw.notes) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return {ok:false,reason:"Malformed MIDI note"};
    const n = entry as Partial<DecodedMidiNote>;
    if (!inRange(n.track,0,31) || !inRange(n.channel,0,15) ||
        !inRange(n.program,0,127) || !inRange(n.pitch,0,127) ||
        !inRange(n.velocity,1,127) ||
        !inRange(n.startUs,0,raw.durationUs) ||
        !inRange(n.endUs,1,raw.durationUs) ||
        n.startUs >= n.endUs!)
      return {ok:false,reason:"Invalid MIDI note value or duration"};
    // The consumer can schedule notes without sorting huge untrusted arrays.
    if (n.startUs < previousStart)
      return {ok:false,reason:"MIDI note onsets are out of order"};
    if (verified.length === 0 && n.startUs > MAX_EDGE_REST_US)
      return {ok:false,reason:"Score starts with too much silence"};
    // A sustained note on ANY track keeps symbolic music alive; overlapping
    // tracks do not falsely count as separate gaps.
    if (n.startUs > soundingUntil + MAX_INTERNAL_REST_US)
      return {ok:false,reason:"Excessive silent gap in symbolic score"};
    soundingUntil = Math.max(soundingUntil,n.endUs);
    previousStart = n.startUs;
    verified.push(Object.freeze({
      track:n.track,channel:n.channel,program:n.program,
      pitch:n.pitch,velocity:n.velocity,startUs:n.startUs,endUs:n.endUs,
    }));
  }

  if (raw.durationUs - soundingUntil > MAX_EDGE_REST_US)
    return {ok:false,reason:"Score declares a silent tail as finished music"};

  // Copy/freeze so the decoder cannot change an already accepted score
  // while asynchronous native synthesis schedules its notes.
  return {ok:true,value:Object.freeze({
    durationUs:raw.durationUs,notes:Object.freeze(verified),
  })};
}
