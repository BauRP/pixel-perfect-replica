/**
 * Validate metadata returned after a genuinely completed native WAV write.
 * A bridge Promise resolving is not itself proof that a real full clip exists.
 * The native layer also verifies RIFF length, 48kHz stereo PCM and disk fsync.
 */
import type { ClipMeta } from "./engine";

export function confirmedFinishedClip(value: unknown, expectedId: string): value is ClipMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const clip = value as Partial<ClipMeta>;
  return typeof expectedId === "string" &&
    expectedId.length > 0 &&
    clip.id === expectedId &&
    typeof clip.durationSec === "number" &&
    Number.isFinite(clip.durationSec) &&
    clip.durationSec >= 60 &&
    clip.durationSec <= 120 &&
    Array.isArray(clip.genreIds) &&
    clip.genreIds.every(id => typeof id === "string") &&
    typeof clip.createdAt === "number" &&
    Number.isFinite(clip.createdAt) && clip.createdAt > 0 &&
    typeof clip.mood === "number" && Number.isFinite(clip.mood) &&
    typeof clip.speed === "number" && Number.isFinite(clip.speed);
}
