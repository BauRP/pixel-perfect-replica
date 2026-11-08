# SoundWorld AR — Android build and platform policy

## What is built
SoundWorld AR uses the preserved Lovable/TanStack React interface with an offline Capacitor 8 Android host. Local fonts are included in the APK. This branch additionally integrates native YAMNet, microphone/step diagnostics, a real PCM output sink and a genuine WAV clip library. **No Magenta streaming model is running yet.**

## Reproducible build
- Follow `.github/workflows/soundworld-android.yml` (Node 22, Java 21, Android SDK 36).
- `bun install`, `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run build:android:web`.
- `npx cap add android && npx cap sync android` generates the host. Build workflow copies the Java plugins, configures MediaPipe and fetches the PINNED YAMNet asset.
- `cd android && bash ./gradlew assembleDebug` compiles the debug APK.
- The GitHub Actions artifact is a debug APK, not a release-signed application.

## Android compatibility
- Android 12 / API 31 is the **minimum configured OS** in the generated Gradle project.
- Current compile/target SDK: 36. Do not advertise API 37 as independently tested just because the app may install on Android 17.
- Account for gesture / three-button navigation, display cutouts, status bar, rotation, keyboard, small screens and large/resizable windows.
- Build-time checks verify APK model presence and `minSdkVersion=31`. Actual tests on Android 12, 13, 14, 15, 16 and 17 remain a separate device acceptance matrix.

## Safety boundaries
- Diagnostics microphone capture begins only with explicit user action; it is released on pause/exit.
- Music player remains honest when Magenta is unavailable. No live AI song, no artificial microphone detections and no fake favorite entries.
- Runtime Java is integrated through Capacitor plugins, with expensive AudioRecord/YAMNet and disk work outside UI thread.
- Avoid changes to Lovable-managed project files or main branch.
