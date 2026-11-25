/** Fermata-0.2B-v1 only: the original checkpoint encodes percussion pitches
 * one semitone above General MIDI due to a 1-based MusicXML field.
 * Apply once at the raw decoder boundary, never to normal MIDI files.
 * The decoder must call this before validating its final DecodedMidiScore.
 */
export function originalFermataPitch(channel:number, rawPitch:number):number {
  if(!Number.isSafeInteger(channel)||channel<0||channel>15||
     !Number.isSafeInteger(rawPitch)||rawPitch<0||rawPitch>127||
     (channel===9&&rawPitch===0))
    throw new Error("Некорректная исходная нота Fermata");
  return channel===9?rawPitch-1:rawPitch;
}
