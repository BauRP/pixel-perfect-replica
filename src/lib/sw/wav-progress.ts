/** Real Android MediaPlayer timings. Never predict progress without a native reading. */
export interface WavProgress { positionMs: number; durationMs: number; percent: number; }
export function verifiedWavProgress(positionMs:unknown,durationMs:unknown):WavProgress|null {
  if(typeof positionMs!=="number" || typeof durationMs!=="number" ||
     !Number.isFinite(positionMs) || !Number.isFinite(durationMs) ||
     durationMs<=0 || durationMs>120_500 || positionMs<0) return null;
  const position=Math.min(Math.round(positionMs),Math.round(durationMs));
  return {positionMs:position,durationMs:Math.round(durationMs),
    percent:Math.min(100,Math.max(0,Math.round(position/durationMs*100)))};
}
export function wavTimestamp(ms:number):string {
  const seconds=Math.max(0,Math.floor(ms/1000));
  return String(Math.floor(seconds/60))+":"+String(seconds%60).padStart(2,"0");
}
