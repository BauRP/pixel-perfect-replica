import type { ClipMeta } from "./engine";
import { latestRealClip } from "./stored-clips";

export interface JourneyDay {
  dayKey: string;
  heading: string;
  count: number;
  minutes: number;
  clips: ClipMeta[];
}

/** Chronological real saved WAVs only. No location or imaginary activity data. */
export function groupRealJourney(clips: readonly ClipMeta[]): JourneyDay[] {
  const unique = new Map<string, ClipMeta>();
  for (const clip of clips) {
    if (!latestRealClip([clip])) continue;
    const old = unique.get(clip.id);
    if (!old || clip.createdAt > old.createdAt) unique.set(clip.id, clip);
  }
  const groups = new Map<string, ClipMeta[]>();
  for (const clip of [...unique.values()].sort((a,b)=>b.createdAt-a.createdAt)) {
    const when = new Date(clip.createdAt);
    const dateKey = [when.getFullYear(),String(when.getMonth()+1).padStart(2,"0"),String(when.getDate()).padStart(2,"0")].join("-");
    const list = groups.get(dateKey) ?? [];
    list.push(clip);
    groups.set(dateKey,list);
  }
  return [...groups.entries()].map(([dayKey,dayClips])=>({
    dayKey,
    heading:new Date(dayClips[0]!.createdAt).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"}),
    count:dayClips.length,
    minutes:Math.round(dayClips.reduce((sum,clip)=>sum+clip.durationSec,0)/60*10)/10,
    clips:dayClips,
  }));
}
