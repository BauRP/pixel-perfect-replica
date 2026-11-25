/**
 * Do not turn a single door slam, horn or uncertain YAMNet prediction into
 * a new musical atmosphere. All thresholds are policy heuristics, NOT accuracy claims.
 */
export type Atmosphere = "rain" | "traffic" | "nature" | "indoor" | "quiet" | "unknown";
export interface AmbientPrediction { label: string; confidence: number; timestamp: number }
export interface StableAmbientEvent { atmosphere: Atmosphere; confidence: number; timestamp: number }

export function classifyAtmosphere(label: string): Atmosphere {
  // Match whole sound-class words, never substrings: AudioSet "Train"
  // contains "rain", and "Window" contains "wind".
  const name = typeof label === "string" ? label.toLowerCase() : "";
  if (/\b(?:rain|raining|rainfall|raindrops?|thunder|thunderstorm|drizzle)\b/.test(name)) return "rain";
  if (/\b(?:car|cars|vehicle|vehicles|bus|buses|truck|trucks|motorcycle|motorcycles|traffic|roadway|train|trains|railroad|railway|subway|tram)\b/.test(name)) return "traffic";
  if (/\b(?:bird|birds|birdsong|wind|windy|insect|insects|forest|animal|animals|stream|waterfall|ocean)\b/.test(name)) return "nature";
  if (/ventilation|air conditioning|inside, small room|inside, large room|inside, public space|mechanical fan|electric fan|refrigerator|domestic sounds, home sounds/.test(name)) return "indoor";
  if (/\b(?:vehicle engine|engine starting|idling|motor vehicle)\b/.test(name)) return "traffic";
  // "Silence" is a real AudioSet/YAMNet output class, not a guessed lack of activity.
  if (name.trim() === "silence") return "quiet";
  return "unknown";
}

/** Require independent consecutive observations and a bounded hold time. */
export class AmbientStabilizer {
  private candidate: Atmosphere = "unknown";
  private hits = 0;
  private lastSeen = 0;
  private current: Atmosphere = "unknown";
  private lastTransition = 0;
  // Battery / thermal throttling can stretch actual YAMNet windows beyond
  // 3.5 seconds. Still require TWO independent windows within 12 seconds.
  private readonly maxConfirmationGapMs=12_000;
  constructor(private readonly minConfidence = 0.53, private readonly requiredHits = 2, private readonly minTransitionMs = 1500) {}
  update(p: AmbientPrediction): StableAmbientEvent | null {
    if (!Number.isFinite(p.confidence) || !Number.isFinite(p.timestamp) ||
        p.timestamp <= 0 || p.confidence > 1 || p.confidence < this.minConfidence) {
      // Secondary low-confidence labels are common within one YAMNet window.
      // Ignore them instead of erasing a previously confirmed candidate.
      return null;
    }
    const next = classifyAtmosphere(p.label);
    if (next === "unknown") return null;
    // Out-of-order native callback must never take us back to an older scene.
    if (this.lastSeen > 0 && p.timestamp <= this.lastSeen) return null;
    // Distinct YAMNet windows only. Several labels from one window are NOT repeat evidence.
    if (this.lastSeen > 0 && p.timestamp - this.lastSeen < 650 && p.timestamp >= this.lastSeen) return null;
    if (next !== this.candidate || p.timestamp - this.lastSeen > this.maxConfirmationGapMs || p.timestamp < this.lastSeen) {
      this.candidate = next; this.hits = 1;
    } else this.hits++;
    this.lastSeen = p.timestamp;
    if (this.hits < this.requiredHits) return null;
    // Repeated, independent real YAMNet windows are a heartbeat confirming
    // the SAME ongoing scene. Do not falsely expire uninterrupted rain after
    // 30s just because the category did not change.
    if (next === this.current)
      return {atmosphere:next,confidence:p.confidence,timestamp:p.timestamp};
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
    const prev = this.times.length ? this.times[this.times.length - 1] : undefined;
    // Hardware callbacks may arrive out of order after an Android pause.
    // Ignore delayed steps rather than replacing the valid cadence history.
    // Invalid/duplicated timestamps must not re-emit an OLD walking status:
    // the UI timestamps any non-unknown callback as "now".
    const ignored = {activity:"unknown" as const,bpm:0,confidence:0};
    if (prev != null && timestamp <= prev) return ignored;
    if (prev != null && timestamp - prev > 2200) this.times = [];
    else if (prev != null && timestamp - prev < 200) return ignored;
    this.times.push(timestamp);
    this.times = this.times.slice(-8);
    return this.estimate();
  }
  private estimate() {
    if (this.times.length < 4) return { activity: "unknown" as const, bpm: 0, confidence: 0 };
    const intervals = this.times.slice(1).map((t,i) => t-this.times[i]!).filter(ms => ms >= 200 && ms <= 2200).sort((a,b)=>a-b);
    if (intervals.length < 3) return { activity: "unknown" as const, bpm: 0, confidence: 0 };
    const mid=Math.floor(intervals.length/2);
    const median=intervals.length%2===0?(intervals[mid-1]!+intervals[mid]!)/2:intervals[mid]!;
    const bpm=Math.round(60000/median);
    if(bpm<40||bpm>300)return {activity:"unknown" as const,bpm:0,confidence:0};
    const consistent=intervals.filter(ms=>Math.abs(ms-median)<=median*.30).length;
    const confidence=Math.min(.85,0.45+.05*intervals.length)*consistent/intervals.length;
    if(confidence<.55)return {activity:"unknown" as const,bpm:0,confidence:0};
    return {activity:bpm>=145?"running" as const:"walking" as const,bpm,confidence};
  }
  reset() { this.times = []; }
}
