import type { ClipMeta } from "./engine";

/**
 * Android may recover a valid WAV with legacy or partial JSON metadata.
 * Trust the native file verification, but never assume that optional display
 * fields are present. Do not edit, delete or invent recordings here.
 */
export interface HistoryClipBatch {
  clips: ClipMeta[];
  skipped: number;
}

export function normalizeHistoryClips(value: unknown): HistoryClipBatch {
  if (!Array.isArray(value)) return { clips: [], skipped: 1 };
  const clips: ClipMeta[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skipped++;
      continue;
    }
    const raw = entry as Record<string, unknown>;
    // An absent ID cannot be used safely for Play/Favorite/Export.
    if (typeof raw.id !== "string" || !raw.id.trim() || seen.has(raw.id)) {
      skipped++;
      continue;
    }
    seen.add(raw.id);
    const validNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    const createdAt = validNumber(raw.createdAt) && raw.createdAt > 0 && raw.createdAt <= 8.64e15 ? raw.createdAt : 0;
    const durationSec = validNumber(raw.durationSec) && raw.durationSec > 0 ? raw.durationSec : 0;
    const genreIds = Array.isArray(raw.genreIds) ? raw.genreIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    const instrumentIds = Array.isArray(raw.instrumentIds) ? raw.instrumentIds.filter((x): x is string => typeof x === "string" && x.length > 0) : undefined;
    clips.push({
      id: raw.id,
      createdAt,
      durationSec,
      genreIds,
      instrumentIds,
      mood: validNumber(raw.mood) ? raw.mood : 0,
      speed: validNumber(raw.speed) ? raw.speed : 0,
      uri: typeof raw.uri === "string" ? raw.uri : undefined,
      favorite: raw.favorite === true,
      exportedUri: typeof raw.exportedUri === "string" ? raw.exportedUri : undefined,
      recoveredProtected: raw.recoveredProtected === true,
    });
  }
  return { clips, skipped };
}
