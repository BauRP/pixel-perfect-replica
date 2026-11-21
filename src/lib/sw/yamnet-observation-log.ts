/**
 * Small in-memory list of REAL YAMNet classification callbacks.
 * Never contains sound samples, speech transcripts, or any persistent data.
 * Accepts multiple class labels from the same inference window but drops
 * duplicate labels, stale callbacks and malformed confidence scores.
 */
export type YamnetObservation = Readonly<{
  label: string; confidence: number; timestamp: number; source: string;
}>;

export class YamnetObservationLog {
  private enabled = false;
  private since = 0;
  private readonly entries: YamnetObservation[] = [];
  private readonly maximum: number;
  constructor(maximum=5) {
    this.maximum = Number.isInteger(maximum) && maximum > 0 && maximum <= 20 ? maximum : 5;
  }

  start(now: number):void {
    this.entries.length = 0;
    this.enabled = Number.isSafeInteger(now) && now > 0;
    this.since = now;
  }
  stop():void { this.enabled = false; this.entries.length = 0; }
  get active():boolean { return this.enabled; }

  ingest(value: unknown, now: number): readonly YamnetObservation[] | null {
    if (!this.enabled || !value || typeof value !== "object") return null;
    const v = value as Partial<YamnetObservation>;
    if (typeof v.label !== "string" || v.label.trim().length === 0 ||
        v.label.length > 120 || typeof v.source !== "string" || v.source.length > 45 ||
        typeof v.confidence !== "number" || !Number.isFinite(v.confidence) ||
        v.confidence < 0 || v.confidence > 1 ||
        typeof v.timestamp !== "number" || !Number.isSafeInteger(v.timestamp) || !Number.isSafeInteger(now) ||
        v.timestamp < this.since || v.timestamp > now + 2000 ||
        now - v.timestamp > 10_000) return null;

    if (this.entries.some(e=>e.timestamp===v.timestamp && e.label===v.label))return null;
    const previous = this.entries[this.entries.length - 1];
    if (previous && v.timestamp < previous.timestamp) return null;
    this.entries.push(Object.freeze({
      label:v.label,confidence:v.confidence,timestamp:v.timestamp,source:v.source,
    }));
    while(this.entries.length>this.maximum) this.entries.shift();
    return this.snapshot();
  }
  snapshot():readonly YamnetObservation[] {return [...this.entries].reverse();}
}
