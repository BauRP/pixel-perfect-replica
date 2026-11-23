"""Static regression guards for real SoundWorld AR hang mitigations.

Actual Android compilation and TS/Vitest run separately in the APK workflow.
These guards assert the safety mechanisms are not accidentally removed.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class FreezeMitigationContracts(unittest.TestCase):
    def source(self, name):
        return (ROOT / name).read_text(encoding="utf-8")

    def test_empty_mic_read_has_cpu_backoff(self):
        source = self.source("native/android/SoundWorldSensorsPlugin.java")
        read_loop = source.split("private void readMic(", 1)[1].split("private void classifyWindow(", 1)[0]
        self.assertIn("if (n < 0) break;", read_loop)
        self.assertIn("SystemClock.sleep(10);", read_loop)
        self.assertIn("if (n <= 0)", read_loop)

    def test_model_asset_probe_cached_across_status_polls(self):
        source = self.source("native/android/SoundWorldSensorsPlugin.java")
        self.assertIn("private volatile Boolean yamnetAssetPresent;", source)
        self.assertIn("if (cached != null) return cached;", source)
        self.assertIn("yamnetAssetPresent = found;", source)

    def test_performance_snapshot_off_bridge_thread_with_single_flight(self):
        source = self.source("native/android/SoundWorldSensorsPlugin.java")
        self.assertIn('new Thread(r, "SoundWorld-Health-Snapshot")', source)
        self.assertIn("snapshotInFlight.compareAndSet(false, true)", source)
        self.assertIn("snapshotWorker.execute(() ->", source)
        self.assertIn("snapshotInFlight.set(false);", source)
        self.assertIn("snapshotWorker.shutdownNow();", source)

    def test_wav_release_not_on_main_service_thread(self):
        source = self.source("native/android/SoundWorldClipPlaybackService.java")
        self.assertIn("mediaReleaseWorker.execute(() ->", source)
        self.assertIn("mediaReleaseWorker.shutdown();", source)
        self.assertIn("previous.setOnPreparedListener(null)", source)
        self.assertIn("previous.setOnErrorListener(null)", source)

    def test_native_saved_player_status_has_deadline(self):
        source = self.source("src/lib/sw/native-music-library.ts")
        self.assertIn("withNativeDeadline(()=>native.playbackStatus(),2500)", source)

if __name__ == "__main__":
    unittest.main()
