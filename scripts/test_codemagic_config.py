"""Source-only verification for the Codemagic Android APK workflow.

No dependency installs, network calls or actual APK builds are performed here.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "codemagic.yaml"
PACKAGE = ROOT / "package.json"
LOCK = ROOT / "bun.lock"


def shell_scripts(config: str) -> list[str]:
    scripts = []
    lines = config.splitlines()
    for i, line in enumerate(lines):
        if line == "        script: |":
            body = []
            for nxt in lines[i + 1:]:
                if nxt and not nxt.startswith("          "):
                    break
                body.append(nxt[10:] if nxt else "")
            scripts.append("\n".join(body))
    return scripts


class CodemagicAndroidContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CONFIG.read_text(encoding="utf-8")

    def test_main_only_and_valid_workflow(self):
        source = self.source
        self.assertIn("soundworld-android-apk:", source)
        self.assertIn("instance_type: mac_mini_m2", source)
        self.assertIn("pattern: main", source)
        self.assertIn("source: true", source)
        self.assertIn("events:\n        - push", source)
        self.assertNotIn("blacksmith", source)
        self.assertNotIn("multi-cam-pov", source)

    def test_node_and_capacitor_8_requirements(self):
        import json
        pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
        self.assertTrue(pkg["dependencies"]["@capacitor/android"].startswith("^8."))
        self.assertTrue(pkg["dependencies"]["@capacitor/core"].startswith("^8."))
        self.assertTrue(pkg["devDependencies"]["@capacitor/cli"].startswith("^8."))
        self.assertIn("node: v22.16.0", self.source)
        self.assertIn("java: 21", self.source)
        self.assertIn("bun install\n", self.source)
        self.assertIn("bun install --frozen-lockfile", self.source)
        self.assertLess(self.source.index("          bun install\n"),
                        self.source.index("          bun install --frozen-lockfile"))

    def test_android_packaging_and_artifacts(self):
        source = self.source
        for item in (
            "bun run build:android:web",
            "npx cap add android",
            "npx cap sync android",
            "minSdkVersion = 31",
            "android-36",
            "SoundWorldSensorsPlugin.java",
            "SoundWorldPlaybackService.java",
            "SoundWorldMusicLibraryPlugin.java",
            "yamnet.tflite",
            "scripts/verify_android_apk.py",
            "assembleDebug",
            "output/soundworld-ar-debug.apk",
            "output/soundworld-ar-debug.apk.sha256",
        ):
            with self.subTest(item=item):
                self.assertIn(item, source)

    def test_bash_script_syntax(self):
        scripts = shell_scripts(self.source)
        self.assertGreaterEqual(len(scripts), 8)
        for index, body in enumerate(scripts, start=1):
            self.assertTrue(body.startswith("set -euo pipefail"),
                            f"Step {index} does not fail on errors")
            check = subprocess.run(
                ["bash", "-n"], input=body, text=True,
                capture_output=True, check=False
            )
            self.assertEqual(check.returncode, 0,
                             f"Step {index}: {check.stderr}")

    def test_release_is_only_after_compiled_verified_apk(self):
        source = self.source
        verification = source.index("- name: Verify APK content and prepare download files")
        publication = source.index("- name: Publish APK to GitHub Releases when token is configured")
        self.assertLess(verification, publication)
        self.assertIn("scripts/verify_android_apk.py", source)
        self.assertIn("scripts/publish_codemagic_release.py", source)
        self.assertIn("scripts.test_publish_codemagic_release", source)
        self.assertIn("GITHUB_RELEASE_TOKEN", (
            ROOT / "scripts/publish_codemagic_release.py"
        ).read_text(encoding="utf-8"))

    def test_lockfile_discrepancy_is_handled(self):
        import json
        pkg = json.loads(PACKAGE.read_text(encoding="utf-8"))
        lock = LOCK.read_text(encoding="utf-8")
        # The source lock lacks native dependencies. The first install must
        # synchronize before strict reproducibility can be enforced.
        missing = [
            item for item in ("@capacitor/android", "@capacitor/core", "@capacitor/cli")
            if item in pkg["dependencies"] or item in pkg["devDependencies"]
        ]
        self.assertEqual(len(missing), 3)
        self.assertIn("bun install\n", self.source)
        self.assertIn("bun install --frozen-lockfile", self.source)
        self.assertTrue(lock.startswith("{\n"))

if __name__ == "__main__":
    unittest.main()
