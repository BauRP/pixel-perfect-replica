/** Reset only diagnostic-session evidence; not the saved preferences.
 * Old microphone/step observations must never leak into a new test session.
 */
import type { AmbientStabilizer, StepPaceEstimator } from "./environment-smoothing";
import type { MusicControlPlanner } from "./music-control";
import type { BirdEvidenceGate } from "./director-live-preview";

export type DiagnosticEvidence = {
  estimator: Pick<StepPaceEstimator,"reset">;
  stabilizer: Pick<AmbientStabilizer,"reset">;
  planner: Pick<MusicControlPlanner,"reset">;
  birds: Pick<BirdEvidenceGate,"reset">;
};

export function resetDiagnosticEvidence(evidence: DiagnosticEvidence): void {
  evidence.estimator.reset();
  evidence.stabilizer.reset();
  evidence.planner.reset();
  evidence.birds.reset();
}
