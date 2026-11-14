/**
 * Fail-closed seek controls for genuine Android MediaPlayer playback.
 * The history slider must never target a different clip, a stale session,
 * or a fabricated duration. Timing comes only from native playbackStatus().
 */
import {verifiedWavProgress,type WavProgress} from "./wav-progress";

export type SavedPlaybackReading = Readonly<{
  clipId:string;
  state:string;
  positionMs?:number;
  durationMs?:number;
}>;

export function verifiedHistoryProgress(
  clipId:string,
  reading:SavedPlaybackReading|null|undefined,
):WavProgress|null {
  if (!clipId || !reading || reading.clipId!==clipId ||
      (reading.state!=="playing" && reading.state!=="paused"))return null;
  return verifiedWavProgress(reading.positionMs,reading.durationMs);
}

export function verifiedHistorySeek(
  wantedClipId:string,
  activeClipId:string,
  positionMs:unknown,
  measured:WavProgress|null,
):number|null {
  if (!wantedClipId || wantedClipId!==activeClipId || !measured ||
      typeof positionMs!=="number" || !Number.isSafeInteger(positionMs) ||
      positionMs<0 || positionMs>measured.durationMs)return null;
  return positionMs;
}
