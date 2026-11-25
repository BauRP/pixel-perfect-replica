"""Focused regression contracts for exactly Astra findings 5–16.

These guard the intended source changes; GitHub CI separately runs TypeScript,
Vitest, Android Gradle and verifies the real APK. Source checks are not a
substitute for emulator runtime testing.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

def src(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")

class AstraFreezeFindings(unittest.TestCase):
    def test_05_stop_remains_independent_of_export(self):
        h = src("src/components/sw/HistoryPage.tsx")
        self.assertIn("const emergencyStop=async()=>",h)
        self.assertIn("onClick={()=>void emergencyStop()}",h)
        self.assertIn("onClick={()=>playing ? void withTimeout",h)
        self.assertNotIn('disabled={busy} aria-label="Остановить WAV"',h)

    def test_06_wav_digest_cached_only_on_safe_metadata(self):
        j = src("native/android/SoundWorldMusicLibraryPlugin.java")
        for expected in ("GENERATION_MODIFIED","exportDatabaseVersion()",
                         "verifiedExportCache","SoundWorldWavExportPolicy.verifyExactCopy(",
                         "cached.mediaStoreVersion.equals(storeVersion)"):
            self.assertIn(expected,j)

    def test_07_history_refresh_single_flight(self):
        h = src("src/components/sw/HistoryPage.tsx")
        self.assertIn("if(reloadInFlight.current)return reloadInFlight.current;",h)
        self.assertIn("reloadInFlight.current=joined;",h)

    def test_08_microphone_commands_are_bounded(self):
        j = src("native/android/SoundWorldSensorsPlugin.java")
        self.assertIn("new java.util.concurrent.ArrayBlockingQueue<>(4)",j)
        self.assertIn("captureCommands.execute(() ->",j)
        self.assertIn("captureStartQueued.compareAndSet(false, true)",j)
        self.assertIn("captureStopScheduled",j)

    def test_09_yamnet_cleanup_not_abandoned_after_six_seconds(self):
        j=src("native/android/SoundWorldSensorsPlugin.java")
        self.assertIn("if(inferenceCleanupPending.get())",j)
        self.assertIn("closingWorker.awaitTermination(1, TimeUnit.SECONDS)",j)
        self.assertIn("inferenceCleanupPending.set(false)",j)

    def test_10_diagnostics_cancel_and_resume(self):
        page=src("src/components/sw/DiagnosticsPage.tsx")
        native=src("native/android/SoundWorldSensorsPlugin.java")
        self.assertIn("operationEpoch.current",page)
        self.assertIn("window.addEventListener(\"focus\",reconcile)",page)
        self.assertIn("disabled={!active&&!pending}",page)
        self.assertIn('o.put("stepsActive", listeningSteps)',native)

    def test_11_error_logging_does_not_spawn_thread_per_error(self):
        j=src("native/android/SoundWorldFreezeMonitor.java")
        ui=src("src/lib/sw/freeze-report.ts")
        self.assertIn("JS_ISSUE_MIN_INTERVAL_MS = 5000L",j)
        self.assertIn("jsIssueWriter.execute(() ->",j)
        self.assertIn("lastIssueRequest[kind]<5000",ui)

    def test_12_old_android_webview_steps(self):
        s=src("src/lib/sw/environment-smoothing.ts")
        self.assertNotIn("this.times.at(-1)",s)
        self.assertIn("this.times[this.times.length - 1]",s)

    def test_13_large_lists_render_incrementally(self):
        h=src("src/components/sw/HistoryPage.tsx")
        d=src("src/components/sw/DislikesPage.tsx")
        self.assertIn("items.slice(0,visibleCounts[section]??30)",h)
        self.assertIn("memo(function Row",d)
        self.assertIn("useSyncExternalStore(subscribeSettings",d)

    def test_14_heavy_pages_are_loaded_on_demand(self):
        for path in ("src/routes/history.tsx",
                     "src/routes/settings.diagnostics.tsx",
                     "src/routes/studio.dislikes.tsx"):
            self.assertIn("lazy(() => import(",src(path))

    def test_15_all_apk_workflows_stage_monitor_classes(self):
        for path in ("codemagic.yaml",".github/workflows/android_build.yml",
                     ".github/workflows/soundworld-android.yml"):
            source=src(path)
            self.assertIn("cp native/android/SoundWorldFreezeMonitor.java",source)
            self.assertIn("cp native/android/SoundWorldFreezePlugin.java",source)

    def test_16_pcm_stop_is_bounded_without_fake_finished_audio(self):
        session=src("src/lib/sw/generated-pcm-session.ts")
        midi=src("src/lib/sw/verified-midi-pcm-bridge.ts")
        pcm=src("src/lib/sw/native-pcm.ts")
        self.assertIn("const drained=await this.bounded(",session)
        self.assertIn("if(!drained.ok)",session)
        self.assertIn("if(this.stopRequested)",session)
        self.assertIn("awaitMidiExternal(",midi)
        self.assertIn("await boundedNativeCall(()=>native.stop()).catch(",pcm)

if __name__=="__main__":
    unittest.main()
