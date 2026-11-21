"""Execute the real publisher against a fake GitHub CLI, never a real upload."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PUBLISHER = Path(__file__).resolve().parent / "publish_apk_release.sh"
FAKE_GH = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with Path("calls.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\\n")
mode = os.environ.get("TEST_FAILURE", "")
if args[:2] == ["release", "create"]:
    if mode == "quota":
        print("HTTP 403: Resource not accessible by integration", file=sys.stderr)
        sys.exit(1)
    Path("created").touch()
elif args[:2] == ["release", "edit"]:
    if mode == "edit":
        print("HTTP 500: publication failed", file=sys.stderr)
        sys.exit(1)
    Path("published").touch()
elif args[0] == "api":
    tag = args[1].split("/")[-1]
    assets = []
    for name in ("soundworld-ar-debug.apk", "soundworld-ar-debug.apk.sha256"):
        asset = {"name": name, "state": "uploaded", "size": (Path("output") / name).stat().st_size,
                 "browser_download_url": f"https://github.com/BauRP/test/releases/download/{tag}/{name}"}
        if mode == "size" and name.endswith(".apk"):
            asset["size"] -= 1
        if mode == "url" and name.endswith(".apk"):
            asset["browser_download_url"] = "https://github.com/BauRP/test/actions/runs/100"
        if mode != "missing" or not name.endswith(".apk"):
            assets.append(asset)
    print(json.dumps({"tag_name": tag, "draft": not Path("published").exists(), "assets": assets}))
else:
    sys.exit(2)
'''


class ApkReleasePublishingTests(unittest.TestCase):
    def run_publisher(self, *, failure="", run="100", attempt="2", corrupt=False):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / "bin").mkdir()
            gh = folder / "bin/gh"
            gh.write_text(FAKE_GH)
            gh.chmod(0o755)
            (folder / "output").mkdir()
            apk = folder / "output/soundworld-ar-debug.apk"
            apk.write_bytes(b"PK-test-app-apk")
            digest = "0" * 64 if corrupt else hashlib.sha256(apk.read_bytes()).hexdigest()
            (folder / "output/soundworld-ar-debug.apk.sha256").write_text(f"{digest}  {apk.name}\n")
            env = {**os.environ, "PATH": f"{folder / 'bin'}:{os.environ['PATH']}",
                   "GH_TOKEN": "unused-test-token", "GITHUB_REPOSITORY": "BauRP/test",
                   "GITHUB_RUN_ID": run, "GITHUB_RUN_ATTEMPT": attempt, "GITHUB_SHA": "a" * 40,
                   "GITHUB_STEP_SUMMARY": str(folder / "summary"), "GITHUB_OUTPUT": str(folder / "outputs"),
                   "TEST_FAILURE": failure}
            result = subprocess.run(["bash", str(PUBLISHER)], cwd=folder, env=env, text=True, capture_output=True)
            calls = [json.loads(line) for line in (folder / "calls.jsonl").read_text().splitlines()] if (folder / "calls.jsonl").exists() else []
            summary = (folder / "summary").read_text() if (folder / "summary").exists() else ""
            outputs = (folder / "outputs").read_text() if (folder / "outputs").exists() else ""
            return result, calls, summary, outputs

    def test_success_returns_githubs_direct_apk_url_after_publication(self):
        result, calls, summary, outputs = self.run_publisher()
        self.assertEqual(result.returncode, 0, result.stderr)
        url = "https://github.com/BauRP/test/releases/download/soundworld-ar-build-100-2/soundworld-ar-debug.apk"
        self.assertIn(f"[Download APK]({url})", summary)
        self.assertEqual(outputs, f"download_url={url}\n")
        self.assertEqual([c[:2] for c in calls], [["release", "create"], ["api", "repos/BauRP/test/releases/tags/soundworld-ar-build-100-2"], ["release", "edit"], ["api", "repos/BauRP/test/releases/tags/soundworld-ar-build-100-2"]])
        self.assertIn("--draft", calls[0])
        self.assertIn("output/soundworld-ar-debug.apk", calls[0])

    def test_each_build_and_retry_gets_its_own_release(self):
        tags = [self.run_publisher(run=run, attempt=attempt)[1][0][2] for run, attempt in [("100", "1"), ("100", "2"), ("101", "1")]]
        self.assertEqual(tags, ["soundworld-ar-build-100-1", "soundworld-ar-build-100-2", "soundworld-ar-build-101-1"])

    def test_upload_failure_never_reports_success(self):
        result, calls, summary, outputs = self.run_publisher(failure="quota")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HTTP 403", result.stderr)
        self.assertEqual(len(calls), 1)
        self.assertEqual((summary, outputs), ("", ""))

    def test_incomplete_asset_never_publishes(self):
        for failure in ("missing", "size"):
            with self.subTest(failure=failure):
                result, calls, summary, outputs = self.run_publisher(failure=failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(["release", "edit"], [c[:2] for c in calls])
                self.assertEqual((summary, outputs), ("", ""))

    def test_non_apk_link_is_rejected(self):
        result, _, summary, outputs = self.run_publisher(failure="url")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((summary, outputs), ("", ""))

    def test_publication_failure_never_reports_success(self):
        result, _, summary, outputs = self.run_publisher(failure="edit")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((summary, outputs), ("", ""))

    def test_checksum_mismatch_never_uploads(self):
        result, calls, summary, outputs = self.run_publisher(corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])
        self.assertEqual((summary, outputs), ("", ""))


if __name__ == "__main__":
    unittest.main()