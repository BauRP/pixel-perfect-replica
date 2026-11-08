/**
 * Do not turn a single door slam, horn or uncertain YAMNet prediction into
 * a new musical atmosphere. All thresholds are policy heuristics, NOT accuracy claims.
 */
export type Atmosphere = "rain" | "traffic" | "nature" | "indoor" | "unknown";
export interface AmbientPrediction { label: string; confidence: number; timestamp: number }
export interface StableAmbientEvent { atmosphere: Atmosphere; confidence: number; timestamp: number }

export function classifyAtmosphere(label: string): Atmosphere {
  const name = label.toLowerCase();
  if (/rain|raindrop|thunder|drizzle/.test(name)) return "rain";
  if (/car|vehicle|bus|truck|motorcycle|traffic|engine|roadway/.test(name)) return "traffic";
  if (/bird|wind|insect|forest|animal/.test(name)) return "nature";
  if (/ventilation|air conditioning|inside, small room/.test(name)) return "indoor";
  return "unknown";
}

/** Require independent consecutive observations and a bounded hold time. */
export class AmbientStabilizer {
  private candidate: Atmosphere = "unknown";
  private hits = 0;
  private lastSeen = 0;
  private current: Atmosphere = "unknown";
  private lastTransition = 0;
  constructor(private readonly minConfidence = 0.53, private readonly requiredHits = 2, private readonly minTransitionMs = 1500) {}
  update(p: AmbientPrediction): StableAmbientEvent | null {
    if (!Number.isFinite(p.confidence) || !Number.isFinite(p.timestamp) ||
        p.confidence < this.minConfidence) {
      this.candidate = "unknown"; this.hits = 0; return null;
    }
    const next = classifyAtmosphere(p.label);
    if (next === "unknown") { this.candidate = "unknown"; this.hits = 0; return null; }
    // Distinct YAMNet windows only. Several labels from one window are NOT repeat evidence.
    if (next === this.candidate && p.timestamp - this.lastSeen < 650 && p.timestamp >= this.lastSeen) return null;
    if (next !== this.candidate || p.timestamp - this.lastSeen > 3500 || p.timestamp < this.lastSeen) {
      this.candidate = next; this.hits = 1;
    } else this.hits++;
    this.lastSeen = p.timestamp;
    if (this.hits < this.requiredHits || next === this.current) return null;
    if (this.current !== "unknown" && p.timestamp - this.lastTransition < this.minTransitionMs) return null;
    this.current = next;
    this.lastTransition = p.timestamp;
    return { atmosphere: next, confidence: p.confidence, timestamp: p.timestamp };
  }
  reset() { this.candidate = "unknown"; this.hits = 0; this.current = "unknown"; this.lastSeen = 0; this.lastTransition = 0; }
  get stable() { return this.current; }
}

/** Steps are separate from microphone YAMNet classes. Missing steps never means rest. */
export class StepPaceEstimator {
  private times: number[] = [];
  ingest(timestamp: number): { activity: "walking" | "running" | "unknown"; bpm: number; confidence: number } {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return { activity: "unknown", bpm: 0, confidence: 0 };
    const prev = this.times.at(-1);
    if (prev != null && (timestamp <= prev || timestamp - prev > 8000)) this.times = [];
    else if (prev != null && timestamp - prev < 260) return this.estimate();
    this.times.push(timestamp);
    this.times = this.times.slice(-8);
    return this.estimate();
  }
  private estimate() {
    if (this.times.length < 4) return { activity: "unknown" as const, bpm: 0, confidence: 0 };
    const intervals = this.times.slice(1).map((t,i) => t-this.times[i]!).filter(ms => ms >= 260 && ms <= 2200).sort((a,b)=>a-b);
    if (intervals.length < 3) return { activity: "unknown" as const, bpm: 0, confidence: 0 };
    const median = intervals[Math.floor(intervals.length/2)]!;
    const bpm = Math.round(60000/median);
    return { activity: bpm >= 145 ? "running" as const : "walking" as const, bpm, confidence: Math.min(.85, 0.45 + .05*intervals.length) };
  }
  reset() { this.times = []; }
}
