/**
 * Count ONLY real Android TYPE_STEP_DETECTOR callbacks during one explicitly
 * started diagnostic session. Do not infer steps from microphone/audio, pace,
 * elapsed time, or absence of events. A count is not proof of walking/running.
 */
export type RawStepForCount = Readonly<{timestamp:number;sensor:string}>;
export type StepCount = Readonly<{count:number;lastStepAt:number}>;

export class RealStepSession {
  private startedAt: number | null = null;
  private lastStepAt: number | null = null;
  private count = 0;

  start(startedAt: number): void {
    this.startedAt = Number.isSafeInteger(startedAt) && startedAt > 0 ? startedAt : null;
    this.lastStepAt = null;
    this.count = 0;
  }

  stop(): void {
    this.startedAt = null;
  }

  ingest(event: RawStepForCount, receivedAt: number): StepCount | null {
    if (this.startedAt === null || !event || event.sensor !== "TYPE_STEP_DETECTOR" ||
        !Number.isSafeInteger(event.timestamp) || !Number.isSafeInteger(receivedAt) ||
        receivedAt <= 0 || event.timestamp < this.startedAt ||
        event.timestamp > receivedAt + 2000 ||
        receivedAt - event.timestamp > 10_000 ||
        (this.lastStepAt !== null && event.timestamp <= this.lastStepAt)) {
      return null;
    }
    // Android TYPE_STEP_DETECTOR reports one physical step per callback.
    // Never debounce distinct real events: rapid running steps are valid.
    this.lastStepAt = event.timestamp;
    this.count++;
    return {count:this.count,lastStepAt:event.timestamp};
  }

  get total(): number {return this.count;}
  get active(): boolean {return this.startedAt !== null;}
}
