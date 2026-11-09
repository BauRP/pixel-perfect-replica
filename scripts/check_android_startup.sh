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


# A process can stay alive with a blank or broken React WebView.
# Accessibility inspection confirms real screen content and navigation.
capture_ui() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb exec-out cat /sdcard/window.xml > /tmp/soundworld-window.xml
  test -s /tmp/soundworld-window.xml

  # A heavily loaded GitHub emulator may show a SYSTEM UI ANR dialog
  # on top of a healthy app. Never confuse it with a SoundWorld crash.
  # Select "Wait" for the operating system, not "Close app".
  if grep -Eq 'System UI isn.t responding|System UI is not responding' /tmp/soundworld-window.xml; then
    echo "::warning::Android emulator System UI ANR; selecting Wait to keep testing SoundWorld"
    local coords
    coords="$(python3 - <<'PY'
import re,xml.etree.ElementTree as ET
root=ET.parse("/tmp/soundworld-window.xml").getroot()
for node in root.iter("node"):
    if node.get("text","").casefold()=="wait":
        b=list(map(int,re.findall(r'\d+',node.get("bounds",""))))
        if len(b)==4: print((b[0]+b[2])//2,(b[1]+b[3])//2)
        break
PY
)"
    if [[ -n "$coords" ]]; then adb shell input tap $coords; sleep 3; fi
    adb shell uiautomator dump /sdcard/window.xml >/dev/null
    adb exec-out cat /sdcard/window.xml > /tmp/soundworld-window.xml
  fi
}
find_ui_text() {
  local needle="$1"
  python3 - "$needle" <<'PY'
import sys, xml.etree.ElementTree as ET
needle=sys.argv[1].casefold()
root=ET.parse("/tmp/soundworld-window.xml").getroot()
hits=[]
for node in root.iter("node"):
    text=" ".join((node.get("text",""),node.get("content-desc",""))).casefold()
    if needle in text: hits.append(node.get("bounds",""))
print("FOUND" if hits else "MISSING",sys.argv[1],hits[:3])
sys.exit(0 if hits else 1)
PY
}
wait_for_ui() {
  local text="$1"
  for _ in 1 2 3 4 5 6 7 8; do
    capture_ui || true
    if find_ui_text "$text"; then return 0; fi
    sleep 2
  done
  echo "::error::WebView failed to expose expected screen: $text"
  head -c 6000 /tmp/soundworld-window.xml || true
  adb logcat -d -v time | grep -E 'chromium|WebView|AndroidRuntime|Capacitor' | tail -n 150 || true
  return 1
}
tap_ui_text() {
  local text="$1"
  local pos=""
  for _ in 1 2 3 4 5; do
    capture_ui
    pos="$(python3 - "$text" <<'PY'
import re,sys,xml.etree.ElementTree as ET
needle=sys.argv[1].casefold()
root=ET.parse("/tmp/soundworld-window.xml").getroot()
for node in root.iter("node"):
    value=(node.get("text","")+" "+node.get("content-desc","")).casefold()
    if needle in value:
        a=list(map(int,re.findall(r'\d+',node.get("bounds",""))))
        if len(a)==4:
            print((a[0]+a[2])//2,(a[1]+a[3])//2)
            break
PY
)"
    if [[ -n "$pos" ]]; then break; fi
    sleep 2
  done
  if [[ -z "$pos" ]]; then
    echo "::error::Missing or covered tap target: $text"
    echo "Visible Android UI XML:"
    head -c 12000 /tmp/soundworld-window.xml || true
    echo
    echo "Active Android activity:"
    adb shell dumpsys activity activities | grep -E 'ResumedActivity|mResumedActivity|topResumedActivity' | head -n 10 || true
    echo "Recent WebView errors:"
    adb logcat -d -v time | grep -E 'Capacitor/Console|AndroidRuntime|System UI' | tail -n 80 || true
    return 1
  fi
  echo "Tap $text at $pos"
  adb shell input tap $pos
}

check_start 1
wait_for_ui "Музыкальные вкусы"
tap_ui_text "Пропустить"
wait_for_ui "Живая музыка"
tap_ui_text "Studio"
wait_for_ui "Настроение"
tap_ui_text "Настройки"
wait_for_ui "Звук и микрофон"
check_start 2
wait_for_ui "Живая музыка"
echo "PASS: two Android starts, onboarding skip, Player, Studio and Settings render"
