# Phase 2: confirmed sensor scope and Magenta feasibility

## Actual Android implementation
The build copies `native/android/SoundWorldSensorsPlugin.java` into the generated Capacitor Android host and registers it in MainActivity. It requests RECORD_AUDIO and ACTIVITY_RECOGNITION only on user action, reads real 16-kHz mono microphone PCM with AudioRecord in a worker thread, reports true RMS/input route, and listens to TYPE_STEP_DETECTOR (if available). Diagnostics stops both on route leave, pause and destroy. These are *diagnostic* components, not continuous background generation or monitoring. No speech is written to files.

The app does **not** ship YAMNet inference yet: `yamnetIncluded=false`, startAnalysis refuses, no synthetic YAMNet events are ever emitted. Type-safe adapter entry points are wired; the step pace algorithm and environment stabilizer are unit tested. The mic probe never claims that it has recognized a rain or traffic event.

## Important: music model is not yet portable to Android
As of 8 Nov 2026 Google's MRT2 official release says `mrt2_small` (230M parameters, ~450 MB *model weights*) streams in real time on Apple Silicon Macs; the Python JAX and MLX backends and Mac-focused C++ engine do not supply a production Android inference runtime. Hardware feasibility, all shared resources (MusicCoCa + SpectroStream), backend conversion, GPU delegates, thermal budget, licenses and streaming must be solved and verified **before** activating MusicEngine.LIVE. APK package size target ~1GB remains unverified.

Official project documentation: https://github.com/magenta/magenta-realtime and https://magenta.withgoogle.com/mrt2

## Reliability boundaries
- No mic permission at first run; explicit test button or future Play required.
- Diagnostic microphone route is reported only after AudioRecord starts, using getRoutedDevice().
- Wired/USB/Bluetooth inputs are preferences, not guaranteed routing. Bluetooth can change playback quality; actual output is still unverified.
- Step detector may not exist; missing footsteps ≠ resting. Motion events don't control audio yet.
- A pause/stop terminates diagnostic recording; proper long-lived foreground media service is separate work.
- Offline fonts bundled; no music audio generated; YAMNet weights not bundled.
- Android 12-17 device matrix, resize/gestures/bars need runtime verification. Don't label supported solely because an APK compiles.

## Verified checkpoints
Use GitHub Actions results to grant points only after CI success. The full progress report is in PROGRESS.md.
