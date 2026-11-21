import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "external_android_build", Path(__file__).with_name("external_android_build.py"))
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

class ExternalBuilderTests(unittest.TestCase):
    def test_extract_native_step_without_capturing_following_steps(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "soundworld-android.yml"
            path.write_text("""jobs:
  verify:
    steps:
      - name: Install real SoundWorld native sensor plugin
        run: |
          set -euo pipefail
          cp native/android/SoundWorldSensorsPlugin.java target.java
          echo yamnet.tflite
          echo SoundWorldPlaybackService
          echo AndroidManifest.xml
      - name: Build shell-only debug APK
        run: |
          echo never-execute-this-step
""")
            with patch.object(mod, "WORKFLOW", path):
                body = mod.source_script("Install real SoundWorld native sensor plugin")
            self.assertIn("SoundWorldSensorsPlugin.java target.java", body)
            self.assertNotIn("never-execute-this-step", body)

    def test_missing_required_native_services_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "soundworld-android.yml"
            path.write_text("      - name: Install real SoundWorld native sensor plugin\n"
                            "        run: |\n          echo no-services\n")
            with patch.object(mod, "WORKFLOW", path):
                with self.assertRaisesRegex(RuntimeError, "required SoundWorld"):
                    mod.source_script("Install real SoundWorld native sensor plugin")

    def test_wrong_step_name_fails(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "soundworld-android.yml"
            path.write_text("jobs:\n")
            with patch.object(mod, "WORKFLOW", path):
                with self.assertRaisesRegex(RuntimeError, "Expected exactly one"):
                    mod.source_script("Install real SoundWorld native sensor plugin")

if __name__ == "__main__":
    unittest.main()
