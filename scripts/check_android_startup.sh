#!/usr/bin/env bash
# Smoke-test the actual APK in a booted Android emulator. Building an APK does
# not prove the Activity can start: verify it stays alive twice.
set -euo pipefail
package="kz.soundworld.ar"
apk="android/app/build/outputs/apk/debug/app-debug.apk"
test -s "$apk"
adb wait-for-device
adb install -r "$apk"
adb shell pm clear "$package" >/dev/null

check_start() {
  local attempt="$1"
  echo "=== SoundWorld Android startup attempt $attempt ==="
  adb shell am force-stop "$package" || true
  adb logcat -c

  local start_result
  start_result="$(adb shell am start -W -n "$package/.MainActivity" 2>&1)"
  printf '%s\n' "$start_result"
  if grep -Eq 'Error:|Exception|does not exist' <<< "$start_result"; then
    adb logcat -d -v time | tail -n 200
    echo "::error::SoundWorld MainActivity could not start"
    return 1
  fi

  # Catch both immediate Java crashes and delayed Capacitor/WebView exits.
  sleep 15
  local pid
  pid="$(adb shell pidof "$package" | tr -d '\r' || true)"
  if [[ -z "$pid" ]]; then
    echo "::error::SoundWorld process terminated after start ($attempt)"
    adb logcat -d -v time | grep -A 70 -B 12 -E "FATAL EXCEPTION|Process: $package|AndroidRuntime|libc" | tail -n 240 || true
    return 1
  fi
  echo "SoundWorld process alive after 15s: PID $pid"

  local log_file="/tmp/soundworld-startup-$attempt.log"
  adb logcat -d -v time > "$log_file"
  if grep -A 15 'FATAL EXCEPTION' "$log_file" | grep -Fq "Process: $package"; then
    echo "::error::AndroidRuntime reports a SoundWorld fatal exception"
    grep -A 70 -B 10 'FATAL EXCEPTION' "$log_file" | tail -n 160 || true
    return 1
  fi
  if ! adb shell dumpsys activity activities | grep -Eq "mResumedActivity|topResumedActivity|ResumedActivity"; then
    echo "::warning::Unable to verify resumed Activity through dumpsys"
  fi
}

check_start 1
check_start 2
echo "PASS: 2 SoundWorld launches remained alive; no app fatal exception"
