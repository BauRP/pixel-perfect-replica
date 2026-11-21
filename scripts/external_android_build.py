#!/usr/bin/env python3
"""Build SoundWorld AR with external Codemagic, reusing original native install."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/soundworld-android.yml"
APK = ROOT / "android/app/build/outputs/apk/debug/app-debug.apk"
OUTPUT = ROOT / "output/soundworld-ar-debug.apk"

def require(condition: bool, why: str) -> None:
    if not condition:
        raise RuntimeError(why)

def source_script(step_name: str) -> str:
    """Extract one reviewed native install shell step; never silently omit code."""
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    step = "      - name: " + step_name
    hits = [i for i, line in enumerate(lines) if line == step]
    require(len(hits) == 1, f"Expected exactly one workflow step: {step_name}")
    start = hits[0]
    next_steps = [i for i in range(start + 1, len(lines)) if lines[i].startswith("      - name: ")]
    end = min(next_steps) if next_steps else len(lines)
    chunk = lines[start:end]
    marker = "        run: |"
    require(marker in chunk, f"Expected multiline shell step: {step_name}")
    body = chunk[chunk.index(marker) + 1:]
    out = []
    for line in body:
        if not line.strip():
            out.append("")
        else:
            require(line.startswith("          "), f"Unexpected YAML indentation: {step_name}: {line}")
            out.append(line[10:])
    script = "\n".join(out).rstrip() + "\n"
    require("SoundWorldSensorsPlugin.java" in script and "yamnet.tflite" in script,
            "Native step is missing required SoundWorld plugin or YAMNet")
    require("SoundWorldPlaybackService" in script and "AndroidManifest.xml" in script,
            "Native step is missing required playback service/manifest")
    return script

def verify_web() -> None:
    output = ROOT / "dist-android"
    require((output / "index.html").is_file(), "Offline Android index.html missing")
    assets = list(output.rglob("*.js")) + list(output.rglob("*.css"))
    require(any(p.suffix == ".js" for p in assets), "Android JavaScript missing")
    require(any(p.suffix == ".css" for p in assets), "Android CSS missing")
    html = (output / "index.html").read_text(encoding="utf-8")
    require('id="root"' in html, "Offline Android HTML root missing")
    print("VERIFIED: offline Android HTML, JS and CSS are present")

def prepare() -> None:
    require((ROOT / "android/app/build.gradle").is_file(), "Capacitor Android host not generated")
    variables = ROOT / "android/variables.gradle"
    require(variables.is_file(), "Capacitor variables.gradle missing")
    text = variables.read_text(encoding="utf-8")
    updated, count = re.subn(r"\bminSdkVersion\s*=\s*\d+", "minSdkVersion = 31", text)
    require(count == 1, "Unexpected Android minSdkVersion configuration")
    variables.write_text(updated, encoding="utf-8")
    sdk_root = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    require(bool(sdk_root) and Path(sdk_root).is_dir(), "Codemagic Android SDK unavailable")
    required = ("platforms;android-36", "build-tools;36.0.0")
    missing = [name for name in required if not (Path(sdk_root) / name.replace(";", "/")).is_dir()]
    if missing:
        manager = shutil.which("sdkmanager")
        if not manager:
            candidates = sorted((Path(sdk_root) / "cmdline-tools").glob("*/bin/sdkmanager"))
            manager = str(candidates[-1]) if candidates else None
        require(bool(manager), "Android SDK 36 missing; sdkmanager unavailable")
        subprocess.run([str(manager), f"--sdk_root={sdk_root}", *missing], check=True)
    (ROOT / "android/local.properties").write_text(
        "sdk.dir=" + str(Path(sdk_root).resolve()).replace("\\", "\\\\") + "\n",
        encoding="utf-8")
    print("VERIFIED: Android SDK 36, minSdk 31, generated Capacitor project")

def native() -> None:
    require((ROOT / "android/app/src/main/AndroidManifest.xml").is_file(),
            "Generate the Android host before installing native code")
    script = source_script("Install real SoundWorld native sensor plugin")
    # The original Linux GH script contains two GNU-only commands.
    # Mac M2: use equivalent BSD/Perl tools, keeping exact YAMNet SHA-256.
    require("stat -c%s android/app/src/main/assets/yamnet.tflite" in script,
            "Original YAMNet model-size check changed unexpectedly")
    require("sha256sum -c -" in script,
            "Original YAMNet checksum check changed unexpectedly")
    script = script.replace(
        "stat -c%s android/app/src/main/assets/yamnet.tflite",
        "wc -c < android/app/src/main/assets/yamnet.tflite",
    ).replace("sha256sum -c -", "shasum -a 256 -c -")
    require('test "$(wc -c <' in script and "shasum -a 256 -c -" in script,
            "macOS YAMNet validation missing")
    subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], cwd=ROOT, check=True)
    print("VERIFIED: Android native services, XML manifest, YAMNet and style files")

def finalize() -> None:
    require(APK.is_file() and APK.stat().st_size > 1_000_000,
            "Generated Android APK missing or abnormally small")
    subprocess.run([sys.executable, "scripts/verify_android_apk.py", str(APK)],
                   cwd=ROOT, check=True)
    OUTPUT.parent.mkdir(exist_ok=True, parents=True)
    shutil.copyfile(APK, OUTPUT)
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    checksum_path = OUTPUT.with_name(OUTPUT.name + ".sha256")
    checksum_path.write_text(f"{digest}  {OUTPUT.name}\n", encoding="ascii")
    require(OUTPUT.stat().st_size == APK.stat().st_size,
            "APK size changed during packaging")
    print("Download in Codemagic > Build > Artifacts:", OUTPUT.name)
    print("APK bytes:", OUTPUT.stat().st_size, "SHA256:", digest)

def main() -> None:
    valid = {"verify-web": verify_web, "prepare": prepare,
             "native": native, "finalize": finalize}
    require(len(sys.argv) == 2 and sys.argv[1] in valid,
            "Usage: external_android_build.py verify-web|prepare|native|finalize")
    valid[sys.argv[1]]()

if __name__ == "__main__":
    main()
