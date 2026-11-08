# SoundWorld AR — Phase 2 native system (8 November 2026)

## What is genuinely integrated
- An offline, pinned YAMNet TFLite model is packaged into the Android APK (SHA256 `4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf`). MediaPipe AudioClassifier reads authentic microphone PCM, off the UI and AudioRecord reader threads.
- A real Android microphone source is selected by user preference (automatic/headset/phone), Android reports the **actual** input source. Sensor `TYPE_STEP_DETECTOR` emits real step events. Both require permissions only on explicit user action.
- Multiple independent observations are needed to confirm ambient changes. Step tempo requests control *future* percussion, not playback-rate modification of existing recordings.
- A real `AudioTrack` service, Android `MediaSession`, foreground notification and bounded PCM queue are compiled into APK. A real 48kHz stereo PCM source is required; without Magenta, this is not audible music. No fake audio.
- A native audio library can accept **genuine generated** PCM and complete 120-second-max WAV clips. Favorite, last-three temporary clips, local metadata and MediaStore export to `Music/SoundWorld AR` are implemented. No clips appear until real PCM is supplied.
- Diagnostics reports actual microphone level, current input, step frequency, available RAM, battery percentage, Android thermal status and inference-window skips. No false temperatures or invented event detections.

## Current limitations and caveats
1. **Magenta RealTime 2 Small**: the official runnable backend targets Apple Silicon; no verified full Android inference path is integrated. Model weights, training-independent inference, tokenizer, decoder, audio streaming, licensing and thermal budget must be resolved before MusicEngine can report LIVE. No model substitution without user approval.
2. **Android 12–17**: minimum SDK 31 is built. APK generation alone does not prove performance or navigation/inset compatibility on all API levels, cutouts, screens and device types.
3. Real YAMNet precision, latency, microphone routing changes and device thermals are untested on hardware. The classifier is entirely local. It must not save or transmit surrounding speech.
4. When the Activity is paused, the **diagnostic** mic probe and step detector stop. A long-running foreground microphone session alongside music has not yet been integrated into the service. Do not claim uninterrupted sensing with a locked screen.
5. Audio output is a real PCM sink, not a fallback instrumental synth and not an imitation of the selected model. A bounded queue does not guarantee gapless playback if the future generator underproduces.
6. Native WAV recording exposes methods to store real generated PCM, but without a working model no music exists to play, favorite or download. Never fabricate a clip or report a download success without a completed file.
7. Audio focus pauses playback, and unplug pauses playback to avoid speaker surprises; complete call handling and optional auto-resume are not yet wired to the live generator.
8. Google YAMNet and third-party runtime license obligations must be reviewed before commercial distribution.

## Verification
- 34 automated tests and Gradle APK build: https://github.com/BauRP/pixel-perfect-replica/actions/runs/42434100095
- Progress and all feature indices: `PROGRESS.md`
- Main branch preserved; native code is inserted into the generated Android host in GitHub Actions.
