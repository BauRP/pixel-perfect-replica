"""Prevent a real Gradle compilation regression in the Capacitor activity.

Capacitor BridgeActivity.onResume() is PUBLIC. A protected override passes
TypeScript and Python UI tests, but cannot compile the Android APK.
The Gradle build remains the authoritative validation.
"""
from pathlib import Path
import re
import unittest


MAIN = Path(__file__).resolve().parent.parent / "native/android/MainActivity.java"


class AndroidLifecycleContractTests(unittest.TestCase):
    def test_capacitor_onresume_override_is_public(self):
        src = MAIN.read_text(encoding="utf-8")
        self.assertRegex(src, r"@Override\s+public\s+void\s+onResume\s*\(\s*\)")
        self.assertIn("super.onResume();", src)

    def test_webview_geometry_is_measured_not_guessed(self):
        src = MAIN.read_text(encoding="utf-8")
        self.assertIn("web.getLocationOnScreen(origin);", src)
        self.assertIn("web.getWidth()", src)
        self.assertIn("web.getHeight()", src)
        self.assertIn("logMeasuredWebView", src)
        self.assertIn("isDestroyed()", src)


if __name__ == "__main__":
    unittest.main()
