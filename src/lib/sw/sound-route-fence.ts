/** Route-generation gate for ACTUAL Android YAMNet callbacks.
 *
 * Two headsets can share the same AudioDeviceInfo type. The Android native
 * classifier stamps each inference window with a monotonically increasing
 * mic-route generation; late callbacks from earlier devices are ignored.
 * Legacy callbacks without the field retain coarse source-based fencing.
 * This module only validates metadata, never stores audio.
 */
export type SoundRouteIdentity = Readonly<{
  source: string;
  routeGeneration?: number;
}>;
export type SoundRouteDecision = "first" | "same" | "changed" | "stale";

export class SoundRouteFence {
  private source: string | null = null;
  private generation: number | null = null;

  observe(value: SoundRouteIdentity): SoundRouteDecision {
    if (typeof value.source !== "string" || !value.source.length)
      return "stale";
    const generation = value.routeGeneration;
    if (generation !== undefined &&
        (!Number.isSafeInteger(generation) || generation < 0))
      return "stale";
    // Once native route generations are observed, a generation-less late
    // callback must not downgrade the gate or reset confirmed YAMNet evidence.
    if (this.generation !== null && generation === undefined) return "stale";
    if (this.source === null) {
      this.source=value.source;
      this.generation=generation ?? null;
      return "first";
    }
    // A late old-inference callback must not reset new confirmed evidence.
    if (generation !== undefined && this.generation !== null &&
        generation < this.generation) return "stale";
    const changed = this.source !== value.source ||
      (generation !== undefined && this.generation !== null &&
        generation !== this.generation);
    if (changed) {
      this.source=value.source;
      this.generation=generation ?? null;
      return "changed";
    }
    if (generation !== undefined && this.generation === null)
      this.generation=generation;
    return "same";
  }

  reset():void {
    this.source=null;
    this.generation=null;
  }
}
