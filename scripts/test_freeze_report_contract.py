"""Safeguard the real native freeze report feature in the generated Android APK."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class FreezeReportContract(unittest.TestCase):
    def read(self, name):
        return (ROOT/name).read_text(encoding="utf-8")

    def test_monitor_is_lifecycle_aware_and_off_main_thread(self):
        src=self.read("native/android/SoundWorldFreezeMonitor.java")
        activity=self.read("native/android/MainActivity.java")
        self.assertIn('new Thread(r, "SoundWorld-Freeze-Watchdog")',src)
        self.assertIn("Looper.getMainLooper().getThread().getStackTrace()",src)
        self.assertIn("WEBVIEW_STALL_MS = 12000L",src)
        self.assertIn("web.evaluateJavascript(\"0\"",src)
        self.assertIn("SoundWorldFreezeMonitor.start(",activity)
        self.assertIn("SoundWorldFreezeMonitor.setForeground(false)",activity)
        self.assertIn("SoundWorldFreezeMonitor.stop()",activity)
        self.assertIn("registerPlugin(SoundWorldFreezePlugin.class)",activity)

    def test_android_build_includes_monitor_and_bridge(self):
        workflow=self.read(".github/workflows/android_build.yml")
        for path in ("SoundWorldFreezeMonitor.java","SoundWorldFreezePlugin.java"):
            self.assertIn("cp native/android/"+path,workflow)

    def test_report_is_final_settings_item(self):
        src=self.read("src/routes/settings.index.tsx")
        self.assertGreater(src.index("<ErrorReportPanel />"),
                           src.index("Сбросить настройки"))
        page=self.read("src/components/sw/ErrorReportPanel.tsx")
        self.assertIn("Отчёт об ошибках",page)
        self.assertIn("Скопировать отчёт",page)
        self.assertIn("buildSafeDiagnosticsReport(",page)
        self.assertIn("readFreezeEvidence()",page)

    def test_heartbeat_is_installed_without_mutating_audio(self):
        shell=self.read("src/components/sw/AppShell.tsx")
        self.assertIn("installFreezeMonitoring()",shell)
        self.assertIn("traceFreezeScreen(loc.pathname)",shell)
        monitor=self.read("native/android/SoundWorldFreezeMonitor.java")
        self.assertNotIn("stopMicrophone",monitor)
        self.assertNotIn("startCapture",monitor)
        self.assertNotIn("MediaPlayer",monitor)
        self.assertIn("This is diagnostic evidence, not a confirmed root cause.",monitor)

if __name__=="__main__":
    unittest.main()
