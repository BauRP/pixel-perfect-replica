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
  # UIAutomator itself can crash or return an empty file on older WebViews.
  # Never overwrite the last valid XML; retry before falling back to the
  # independently logged React DOM geometry.
  for _ in 1 2 3; do
    adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
    adb exec-out cat /sdcard/window.xml > /tmp/soundworld-window-next.xml 2>/dev/null || true
    if grep -q '<hierarchy' /tmp/soundworld-window-next.xml 2>/dev/null; then
      mv /tmp/soundworld-window-next.xml /tmp/soundworld-window.xml
      break
    fi
    sleep 1
  done
  test -s /tmp/soundworld-window.xml || return 1

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
    adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
    adb exec-out cat /sdcard/window.xml > /tmp/soundworld-window-next.xml 2>/dev/null || true
    if grep -q '<hierarchy' /tmp/soundworld-window-next.xml 2>/dev/null; then
      mv /tmp/soundworld-window-next.xml /tmp/soundworld-window.xml
    fi
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
# Android WebView may omit virtual DOM nodes from UIAutomator even when React
# rendered them. Verify React's actual mounted heading in logcat as a fallback.
visible_dom_route() {
  local route="$1" heading="$2"
  adb logcat -d -v brief | python3 -c '
import sys,json
route,heading=sys.argv[1:3]
for line in sys.stdin:
    marker="SW_NAV_GEOMETRY "
    if marker not in line:continue
    try: data=json.loads(line.split(marker,1)[1].strip())
    except (ValueError,IndexError): continue
    if data.get("path")==route and heading.casefold() in data.get("heading","").casefold():
        if not data.get("root") or not data.get("shell"): continue
        print("DOM_ROUTE_OK",route,"heading=",data.get("heading"),"nav=",data.get("nav"))
        sys.exit(0)
sys.exit(1)
' "$route" "$heading"
}
# Tap an Android tab by its actual measured nav bounding box, not fixed pixels.
# Used only if accessibility omits WebView virtual links on an old WebView.
tap_measured_tab() {
  local label="$1"
  adb logcat -d -v brief | python3 -c '
import sys,json,xml.etree.ElementTree as ET,re,subprocess
label=sys.argv[1]
data=None
for line in sys.stdin:
    marker="SW_NAV_GEOMETRY "
    if marker not in line:continue
    try: x=json.loads(line.split(marker,1)[1].strip())
    except (ValueError,IndexError):continue
    if x.get("path") in ("/", "/studio", "/settings") and x.get("nav") and len(x.get("tabs",[]))==3:
        data=x
if data is None or label not in data["tabs"]:
    raise SystemExit("No measured visible nav with tab "+label)
xml=ET.parse("/tmp/soundworld-window.xml").getroot()
top=None
# Prefer the WebView real window top, otherwise Android content root.
# Old WebViews sometimes omit all virtual accessibility children.
for preferred in ("android.webkit.WebView", "android:id/content"):
    for node in xml.iter("node"):
        if node.get("class")==preferred or node.get("resource-id")==preferred:
            nums=list(map(int,re.findall(r"\d+",node.get("bounds",""))))
            if len(nums)==4:
                top=nums[1]
                break
    if top is not None: break
if top is None:
    # UIAutomator may return an empty accessibility tree. Native window top
    # is still inferable from Android physical screen and WebView viewport.
    physical=subprocess.check_output(["adb","shell","wm","size"],text=True)
    m=re.search(r"(\d+)x(\d+)",physical)
    if not m:raise SystemExit("Cannot locate Android screen")
    viewportHeight=float(data["vh"])*float(data["dpr"])
    top=round(max(0,int(m.group(2))-viewportHeight)*0.4)
idx=data["tabs"].index(label)
dpr=float(data["dpr"])
x=round((idx+0.5)*float(data["vw"])*dpr/3)
y=round(top+(data["nav"]["top"]+data["nav"]["bottom"])*dpr/2)
print("Measured tab tap:",label,x,y,file=sys.stderr)
subprocess.run(["adb","shell","input","tap",str(x),str(y)],check=True)
' "$label"
}
wait_for_ui() {
  local text="$1"
  for _ in 1 2 3 4 5 6 7 8; do
    capture_ui || true
    if find_ui_text "$text" 2>/dev/null; then return 0; fi
    case "$text" in
      "Живая музыка") visible_dom_route "/" "$text" && return 0 ;;
      "Настроение") visible_dom_route "/studio" "Studio" && return 0 ;;
      "Звук и микрофон") visible_dom_route "/settings" "Настройки" && return 0 ;;
    esac
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
    if [[ "$text" == "Studio" || "$text" == "Настройки" ]]; then
      if tap_measured_tab "$text"; then return 0; fi
    fi
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
