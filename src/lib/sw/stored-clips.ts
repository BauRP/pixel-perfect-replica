import type { ClipMeta } from "./engine";

/** Only return a completed, persisted file. No guessed "current" ID. */
function verifiedMetadataCandidates(clips: readonly ClipMeta[]): ClipMeta[] {
  return clips.filter(c => (
    /^[0-9a-f-]{36}$/i.test(c.id)
    && Number.isFinite(c.createdAt) && c.createdAt > 0
    && Number.isFinite(c.durationSec) && c.durationSec > 0 && c.durationSec <= 120
    && typeof c.uri === "string" && c.uri.startsWith("file:")
  ));
}

export function latestRealClip(clips: readonly ClipMeta[]): ClipMeta | null {
  return verifiedMetadataCandidates(clips).sort((a,b)=>b.createdAt-a.createdAt)[0] ?? null;
}

/** An actual previous completed recording, never replay the newest one by mistake. */
export function previousRealClip(clips: readonly ClipMeta[], currentClipId?: string): ClipMeta | null {
  const ordered = verifiedMetadataCandidates(clips).sort((a,b)=>b.createdAt-a.createdAt);
  if (ordered.length < 2) return null;
  const currentIndex = ordered.findIndex(c=>c.id===currentClipId);
  return ordered[currentIndex < 0 ? 1 : currentIndex + 1] ?? null;
}

/** Protected clips are never evicted while limiting recent temporary history. */
export function mayEvictClip(clip: ClipMeta, currentlyPlayingId?: string): boolean {
  // The active native MediaPlayer owns its WAV until explicit Stop or completion.
  return clip.id !== currentlyPlayingId &&
    !clip.favorite && !clip.exportedUri && !clip.recoveredProtected;
}
