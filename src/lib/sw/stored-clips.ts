import type { ClipMeta } from "./engine";

/** Only return a completed, persisted file. No guessed "current" ID. */
export function latestRealClip(clips: readonly ClipMeta[]): ClipMeta | null {
  const candidates = clips.filter(c => (
    /^[0-9a-f-]{36}$/i.test(c.id)
    && Number.isFinite(c.createdAt) && c.createdAt > 0
    && Number.isFinite(c.durationSec) && c.durationSec > 0 && c.durationSec <= 120
    && typeof c.uri === "string" && c.uri.startsWith("file:")
  ));
  if(!candidates.length) return null;
  return [...candidates].sort((a,b)=>b.createdAt-a.createdAt)[0]!;
}

/** Protected clips are never evicted while limiting recent temporary history. */
export function mayEvictClip(clip: ClipMeta): boolean {
  return !clip.favorite && !clip.exportedUri && !clip.recoveredProtected;
}
