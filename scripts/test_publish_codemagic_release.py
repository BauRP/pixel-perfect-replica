"""Source-only protection of the stable latest APK publishing contract.

These checks NEVER send GitHub API requests or reveal access tokens.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/publish_codemagic_release.py"
SPEC = importlib.util.spec_from_file_location("soundworld_release", MODULE_PATH)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class LatestGitHubApkTests(unittest.TestCase):
    def test_direct_link_targets_latest_verified_apk(self):
        self.assertEqual(
            release.LATEST_APK_URL,
            "https://github.com/BauRP/pixel-perfect-replica/releases/latest/"
            "download/soundworld-ar-debug.apk",
        )

    def test_absent_token_does_not_block_codemagic_artifacts(self):
        with patch.dict(os.environ, {"GITHUB_RELEASE_TOKEN": ""}):
            self.assertEqual(release.main(), 0)

    def test_never_publish_an_outdated_commit(self):
        with tempfile.TemporaryDirectory() as dirname:
            folder = Path(dirname)
            apk = folder / "soundworld-ar-debug.apk"
            apk.write_bytes(b"PK" + b"0" * 1048576)
            check = folder / "soundworld-ar-debug.apk.sha256"
            check.write_text(hashlib.sha256(apk.read_bytes()).hexdigest()
                             + "  " + apk.name + "\n")
            older = "a" * 40
            newer = "b" * 40
            env = {
                "GITHUB_RELEASE_TOKEN": "unused-test-token",
                "CM_REPO_SLUG": "BauRP/pixel-perfect-replica",
                "CM_BRANCH": "main",
                "CM_COMMIT": older,
                "CM_BUILD_ID": "test_build_2026",
            }
            with patch.dict(os.environ, env), \
                    patch.object(release, "APK", apk), \
                    patch.object(release, "CHECKSUM", check), \
                    patch.object(release, "request_json", return_value={
                        "commit": {"sha": newer}
                    }) as api, \
                    patch.object(release, "upload_asset") as upload:
                self.assertEqual(release.main(), 0)
                api.assert_called_once()
                upload.assert_not_called()

    def test_reject_wrong_repository(self):
        with patch.dict(os.environ, {
            "GITHUB_RELEASE_TOKEN": "unused-test-token",
            "CM_REPO_SLUG": "other/not-soundworld",
        }):
            with self.assertRaisesRegex(RuntimeError, "outside"):
                release.main()

    def test_release_assets_must_precede_latest(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertLess(source.index("upload_asset(upload_url"),
                        source.index("method=\"PATCH\""))
        self.assertIn('"draft": True', source)
        self.assertIn('"make_latest": "true"', source)
        self.assertIn('main_sha != sha', source)


if __name__ == "__main__":
    unittest.main()
