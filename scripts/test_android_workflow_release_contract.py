"""Check expensive private-repo Android workflow safety without extra packages.

This script checks the workflow itself before running Android/Gradle and helps
catch accidental shell syntax errors in inline GitHub Actions commands.
"""
from pathlib import Path
import re
import subprocess
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/soundworld-android.yml"
APK_WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/android_build.yml"


def shell_step_bodies(text: str) -> list[str]:
    lines = text.splitlines(keepends=True)
    bodies: list[str] = []
    for at, line in enumerate(lines):
        marker = re.match(r"^( *)run: \|\s*$", line)
        if not marker:
            continue
        indent = len(marker.group(1))
        body: list[str] = []
        for subsequent in lines[at + 1:]:
            if subsequent.strip() and len(subsequent) - len(subsequent.lstrip(" ")) <= indent:
                break
            if subsequent.strip():
                if not subsequent.startswith(" " * (indent + 2)):
                    raise AssertionError("Malformed workflow run block indentation")
                body.append(subsequent[indent + 2:])
            else:
                body.append("\n")
        bodies.append("".join(body))
    return bodies


class AndroidWorkflowReleaseContract(unittest.TestCase):
    def test_builds_on_code_pushes_but_not_progress_only(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("\n  push:", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("cancel-in-progress: true", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("verify_android_emulators:", source)
        self.assertIn("default: false", source)
        self.assertGreaterEqual(source.count("inputs.verify_android_emulators"), 11)
        self.assertIn("Publish diagnostic APK to GitHub Releases", source)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && inputs.verify_android_emulators && steps.publish_diagnostic_apk.outcome == 'success'", source)

    def test_all_multiline_bash_steps_have_valid_syntax(self):
        for workflow in (WORKFLOW, APK_WORKFLOW):
            source = workflow.read_text(encoding="utf-8")
            blocks = shell_step_bodies(source)
            self.assertGreaterEqual(len(blocks), 10)
            for index, body in enumerate(blocks, start=1):
                result = subprocess.run(["bash", "-n"], input=body, text=True, capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, f"{workflow.name} step {index}: {result.stderr}")

    def test_release_and_backup_do_not_disappear(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("gh release create", source)
        self.assertIn("actions/upload-artifact@v4", source)
        self.assertIn("Confirm at least one APK download path succeeded", source)
        self.assertIn("soundworld-ar-debug.apk.sha256", source)
        self.assertNotIn('"\\n            echo "', source)

    def test_active_apk_in_main_and_safe_publishing(self):
        source = APK_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("branches: [main]", source)
        self.assertIn("id: prepare_download", source)
        self.assertIn("steps.prepare_download.outcome == 'success'", source)
        self.assertIn("scripts/upload_apk_external.py", source)
        self.assertIn("gh release create", source)
        self.assertIn("actions/upload-artifact@v4", source)
        self.assertIn("blacksmith-4vcpu-ubuntu-2404", source)
        self.assertIn("scripts.test_upload_apk_external scripts.test_android_workflow_release_contract", source)
        self.assertNotIn("multi-cam-pov", source)

if __name__ == "__main__":
    unittest.main()
