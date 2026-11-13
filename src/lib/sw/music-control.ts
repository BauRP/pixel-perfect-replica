/**
 * Deterministic control signals for a FUTURE streaming music generator/DSP.
 * This module NEVER outputs sound or claims that Magenta is running.
 * All inputs must be confirmed real events from the native sensors.
 */
import type { Settings } from "./settings";
import type { Atmosphere, StableAmbientEvent } from "./environment-smoothing";

export type ActivityEstimate = { bpm: number; confidence: number; timestamp: number };
export interface ControlPlan {
  atmosphere: Atmosphere;
  tempoBpm: number; // requested composition tempo, NOT playback-rate manipulation
  stepPulseBpm: number | null; // separate accent layer; does not speed up source music
  stepAccentStrength: number; // weak/normal/active affect intensity, not sensor availability
  mood: number;
  activity: "walking" | "running" | "unknown";
  density: number; // 0..1, no playback-volume changes
  transitionMs: number;
  regenerate: boolean;
  lockedAtmosphere: boolean;
  directorEffects: string[];
  allowProcessedAmbientAudio: boolean;
  gainCeiling: 0.85; // limiter setting for eventual audio runtime, NOT a claim of real limiting
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const transitions = { smooth: 8000, fast: 2800, auto: 4800 } as const;

export class MusicControlPlanner {
  private atmosphere: Atmosphere = "unknown";
  private locked = false;
  private lastMajorChangeAt = -Infinity;
  private lastPace: ActivityEstimate | null = null;
  private regenerationDue = false;

  setAtmosphereLock(value: boolean) { this.locked = value; }
  observeAmbient(input: StableAmbientEvent, settings: Settings): boolean {
    if (settings.musicOnlyMode || this.locked || input.atmosphere === "unknown") return false;
    const threshold = settings.environmentReaction==="weak" ? .8 : settings.environmentReaction==="strong" ? .53 : .65;
    if (!Number.isFinite(input.confidence) || input.confidence < threshold ||
        !Number.isFinite(input.timestamp)) return false;
    if (input.atmosphere === this.atmosphere) return false;
    // At least 20s before another full AI composition request; micro-adjustments do not use this.
    const minimumMajorInterval = settings.environmentReaction==="weak" ? 35000 :
      settings.environmentReaction==="strong" ? 12000 : 20000;
    if (this.atmosphere !== "unknown" && input.timestamp - this.lastMajorChangeAt < minimumMajorInterval) return false;
    this.atmosphere = input.atmosphere;
    this.lastMajorChangeAt = input.timestamp;
    this.regenerationDue = true;
    return true;
  }
  observePace(input: ActivityEstimate): boolean {
    if (!Number.isFinite(input.timestamp) || !Number.isFinite(input.bpm) ||
        !Number.isFinite(input.confidence) || input.confidence < 0.55 ||
        input.bpm < 40 || input.bpm > 225) return false;
    if (this.lastPace && input.timestamp <= this.lastPace.timestamp) return false;
    // An old cadence is not evidence for the user's new walking speed.
    // After a long sensor gap, adopt the fresh measured pace without blending
    // it with the rate from before a pause or stopped walk.
    const recent = this.lastPace && input.timestamp - this.lastPace.timestamp <= 8000;
    const bpm = recent ? this.lastPace!.bpm * .7 + input.bpm * .3 : input.bpm;
    this.lastPace = { ...input, bpm };
    return true;
  }
  plan(settings: Settings, now: number): ControlPlan {
    const tempoBpm = 94 + clamp(settings.speed, -3, 3) * 10;
    const fresh = !settings.musicOnlyMode && this.lastPace && now >= this.lastPace.timestamp &&
      now - this.lastPace.timestamp <= 4500 ? this.lastPace : null;
    const basePulse = fresh && settings.activityMode !== "rest" &&
      settings.activityMode !== "transport" ? fresh.bpm : null;
    // Respect deliberate slow tempo even while the listener is running:
    // step accents may be HALF-TIME, without retiming the generated music.
    const halfTime = basePulse !== null && settings.speed <= -2 && basePulse > 125;
    const stepPulseBpm = basePulse === null ? null :
      Math.round(clamp(halfTime ? basePulse / 2 : basePulse, 55, 180));
    const activity = settings.activityMode === "running" ? "running" : settings.activityMode === "walking" ? "walking" :
      settings.activityMode === "rest" || settings.activityMode === "transport" ? "unknown" :
      !fresh ? "unknown" : fresh.bpm >= 145 ? "running" : "walking";
    const strength = settings.environmentReaction === "weak" ? .12 :
      settings.environmentReaction === "medium" ? .28 : .44;
    const density = clamp(.36 + Math.max(0, settings.mood) * .035 +
      (activity === "running" ? .11 : 0) * strength / .28, .25, .7);
    const env: Atmosphere = settings.musicOnlyMode ? "unknown" : this.atmosphere;
    const directorEffects: string[] = [];
    const enabled = new Set(settings.directorRules.filter(x=>x.enabled).map(x=>x.id));
    if (stepPulseBpm !== null && enabled.has("steps-drums")) directorEffects.push("accent-step-percussion");
    if (env === "rain" && enabled.has("rain-soft")) directorEffects.push("soften-arrangement");
    if (env === "traffic" && enabled.has("transport-pads")) directorEffects.push("deeper-pads");
    if (env === "nature" && enabled.has("birds-melody")) directorEffects.push("brighter-melody");
    if (env === "quiet" && enabled.has("quiet-sparse")) directorEffects.push("sparser-arrangement");
    const regenerate = !settings.musicOnlyMode && !this.locked && this.regenerationDue;
    this.regenerationDue = false;
    return {
      atmosphere: env, tempoBpm, stepPulseBpm,
      stepAccentStrength: settings.stepsInfluence === "weak" ? .12 : settings.stepsInfluence === "active" ? .6 : .32,
      mood: settings.mood,
      activity, density, transitionMs: transitions[settings.atmosphereTransition],
      regenerate, lockedAtmosphere: this.locked,
      directorEffects, allowProcessedAmbientAudio: !settings.musicOnlyMode &&
        settings.useOfEnvironmentSounds === "mixProcessed",
      gainCeiling: .85,
    };
  }
  reset() {
    this.atmosphere = "unknown"; this.locked = false;
    this.lastPace = null; this.lastMajorChangeAt = -Infinity; this.regenerationDue = false;
  }
}
