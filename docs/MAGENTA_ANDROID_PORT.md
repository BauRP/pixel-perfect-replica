# SoundWorld AR — Magenta RealTime 2 Small (Android port audit)

Date: 2026-11-08. Implementation status: **NOT RUNNING ON ANDROID**.
This document records upstream sources and technical gates; it is not a substitute for a native inference backend.

## Verified model inventory (upstream)

Official upstream: https://github.com/magenta/magenta-realtime
Model layout and supported platforms: https://github.com/magenta/magenta-realtime/blob/main/docs/models.md
Original model card: https://huggingface.co/google/magenta-realtime-2

MRT2 requires all three parts:

1. **MusicCoCa** prompt/style embeddings. Official resource files:
   `audio_preprocessor.tflite`, `music_encoder.tflite`,
   `pretrained_vector_quantizer.tflite`, `spm.model`, `text_encoder.tflite`.
2. **SpectroStream** audio-token codec. Official layout includes
   `encoder.safetensors`, `decoder.safetensors`, `quantizer.safetensors`,
   and `spectrostream_encoder.mlxfn`.
3. **Depthformer** framewise autoregressive transformer `mrt2_small`
   (~230 million parameters). Official model package contains `mrt2_small.mlxfn`,
   `mrt2_small_state.safetensors`, and research checkpoint `mrt2_small.safetensors`.

MRT2 official streaming implementation is targeted to **Apple Silicon**.
The JAX/MLX research backends and Apple Silicon C++/MLX engine do not
constitute a verified working Android backend. Some TFLite assets of MusicCoCa
are not sufficient to run the complete music system. No Android inference or
real-time performance results are implied.

## Required engineering gates before enabling the Play button

1. Verify terms and provenance of the complete official weights/assets, preserve license and attribution obligations. Code uses Apache-2.0 and weights CC BY 4.0, subject to upstream additional use terms. Do not commit incomplete/unauthorized artifacts.
2. Obtain the **complete** small-model resource set with reproducible SHA-256; bundle offline in APK or Android app package, no mandatory post-install download.
3. Port/tune embedding (MusicCoCa), token generation (Depthformer), and
   SpectroStream decode to Android's supported CPU/GPU/NPU APIs without
   silently substituting the user-selected model.
4. Feed **real 48 kHz stereo 16-bit PCM** into the existing bounded
   `GeneratedPcmSession` and native `AudioTrack` sink.
   The current pipeline is tested for persistence/ordering but still has
   **no actual model producer**.
5. Measure true streaming real-time factor (>1), first-sound latency,
   seamless joins at 120s, RAM, energy use, thermals and dropped audio frames
   on actual target hardware. A compilation-only result is insufficient.
6. Test paused, headphone-unplugged, focus-loss, call, offline, locked-screen
   and recovery scenarios before advertising uninterrupted background music.

## Hard constraints

- Instrumental-only: no vocals and no prerecorded loops masquerading as AI.
- Preserve exactly three bottom tabs: `Player`, `Studio`, `Настройки`.
- Android 12 (API31) minimum; later Android versions and window sizes require
  independent validation; do not claim tested compatibility from targetSdk alone.
- No new streaming API or mandatory cloud network, no extra model downloads.
- Do not claim quality, support of specific instruments or real-time readiness
  until proven with **real** audio generation and validated recordings.
- Do not give Magenta integration progress points for documentation alone.

## Current project facts

- Bundled YAMNet is a **separate ambient sound classifier**, not a music model.
- The user-facing `MusicEngine` is intentionally `UNAVAILABLE`.
- `src/lib/sw/music-preferences.ts` builds a future control plan, not sound.
- `src/lib/sw/generated-pcm-session.ts` is a genuine PCM output/persistence
  pipeline, not a synthesizer.
- `docs/PHASE2_NATIVE.md`, `PROGRESS.md` provide the native handoff and
  feature indices.

This document identifies an unresolved porting risk, **not** a confirmed
impossibility of running the model on any future Android hardware.
