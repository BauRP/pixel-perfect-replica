/**
 * Pure Android media/audio-focus transition policy. No fake playback:
 * this decides what a future real service must do.
 */
export type UserPlayback = "stopped" | "playing" | "paused";
export type AudioInterruption = "call-start" | "call-end" | "audio-focus-loss" |
  "audio-focus-gain" | "headset-disconnected" | "user-play" | "user-pause" | "user-stop";
export interface PolicyState {
  playback: UserPlayback;
  interruptedByCall: boolean;
  resumeAfterCall: boolean;
  resumeAfterFocus: boolean;
  headsetWasDisconnected: boolean;
}
export interface PolicyResult {
  state: PolicyState;
  action: "play" | "pause" | "stop" | "none";
}
export const INITIAL_POLICY: PolicyState = {
  playback: "stopped", interruptedByCall: false, resumeAfterCall: false,
  resumeAfterFocus: false, headsetWasDisconnected: false,
};
export function transitionAudioPolicy(
  old: PolicyState,
  event: AudioInterruption,
  allowAfterCall: boolean,
): PolicyResult {
  const state = { ...old };
  let action: PolicyResult["action"] = "none";
  switch (event) {
    case "user-play":
      if (!state.interruptedByCall) {
        state.playback = "playing"; state.headsetWasDisconnected = false;
        state.resumeAfterCall = false; state.resumeAfterFocus = false; action = "play";
      }
      break;
    case "user-pause":
      state.playback = "paused";
      state.resumeAfterCall = state.resumeAfterFocus = false;
      action = "pause";
      break;
    case "user-stop":
      return { state: { ...INITIAL_POLICY }, action: "stop" };
    case "call-start":
      // Duplicate Android call notifications must not erase the permission
      // to resume a session that was actually playing before the first call.
      if (state.interruptedByCall) break;
      state.interruptedByCall = true;
      state.resumeAfterCall = state.playback === "playing";
      state.resumeAfterFocus = false;
      if (state.playback === "playing") { state.playback = "paused"; action = "pause"; }
      break;
    case "call-end":
      state.interruptedByCall = false;
      if (state.resumeAfterCall && allowAfterCall && !state.headsetWasDisconnected) {
        state.playback = "playing"; action = "play";
      }
      state.resumeAfterCall = false;
      break;
    case "audio-focus-loss":
      // Repeated focus-loss callbacks while already paused are not a user
      // pause request. Preserve the earlier eligible resume state.
      if (state.playback === "playing") {
        state.resumeAfterFocus = true; state.playback = "paused"; action = "pause";
      }
      break;
    case "audio-focus-gain":
      if (state.resumeAfterFocus && !state.interruptedByCall && !state.headsetWasDisconnected) {
        state.playback = "playing"; action = "play";
      }
      state.resumeAfterFocus = false;
      break;
    case "headset-disconnected":
      state.headsetWasDisconnected = true;
      state.resumeAfterCall = state.resumeAfterFocus = false;
      if (state.playback === "playing") { state.playback = "paused"; action = "pause"; }
      break;
  }
  return { state, action };
}
