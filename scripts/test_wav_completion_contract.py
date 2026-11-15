"""Early static contracts for the full WAV playback/export integration.
Not a replacement for Android Gradle or emulator tests.
"""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class WavCompletionIntegration(unittest.TestCase):
    def test_saved_wav_service_enforces_60_to_120_seconds(self):
        service=(ROOT/"native/android/SoundWorldClipPlaybackService.java").read_text()
        self.assertIn("SoundWorldClipLengthPolicy.canFinish(data)",service)
        self.assertIn('data != file.length() - 44',service)

    def test_export_retries_reuse_only_verified_existing_copy(self):
        library=(ROOT/"native/android/SoundWorldMusicLibraryPlugin.java").read_text()
        self.assertIn("exportedCopyMatches(file,previousUri)",library)
        self.assertIn("SoundWorldWavExportPolicy.verifyExactCopy(original,saved,source.length())",library)
        self.assertIn("existing.put(\"uri\",previousUri)",library)
        self.assertIn("SoundWorldWavExportPolicy.verifyExactCopy(source,saved,file.length())",library)
        self.assertIn("getContentResolver().delete(outputUri,null,null)",library)

    def test_android_rejects_out_of_range_seek_instead_of_silent_clamping(self):
        service=(ROOT/"native/android/SoundWorldClipPlaybackService.java").read_text()
        self.assertIn("duration <= 0 || ms > duration",service)
        self.assertIn("player.seekTo((int)ms)",service)
        self.assertNotIn("player.seekTo((int)Math.min(ms, (long)duration))",service)

    def test_saved_exports_do_not_show_same_size_corrupt_media(self):
        library=(ROOT/"native/android/SoundWorldMusicLibraryPlugin.java").read_text()
        listing=library.split("@PluginMethod public void list(PluginCall call)",1)[1].split(
            "@PluginMethod public void favorite",1
        )[0]
        self.assertIn("exportedCopyMatches(clipFile(id)",listing)
        self.assertNotIn("exportedCopyExists(item.optString",listing)

    def test_export_is_not_visible_before_sha256_verification(self):
        src=(ROOT/"native/android/SoundWorldMusicLibraryPlugin.java").read_text()
        export=src.split("@PluginMethod public void export(PluginCall call)",1)[1].split(
            "@PluginMethod public void deleteTemporary",1
        )[0]
        verify=export.index("SoundWorldWavExportPolicy.verifyExactCopy(source,saved,file.length())")
        publish=export.index("MediaStore.Audio.Media.IS_PENDING,0")
        self.assertLess(verify,publish)
        self.assertIn("getContentResolver().delete(outputUri,null,null)",export)

    def test_history_may_stop_during_native_prepare(self):
        history=(ROOT/"src/routes/history.tsx").read_text()
        self.assertIn("historyClipCanStop(c.id,playback)",history)
        self.assertIn('Android подготавливает WAV. Можно остановить воспроизведение.',history)

    def test_player_export_uses_long_native_verification_timeout(self):
        player=(ROOT/"src/routes/index.tsx").read_text()
        self.assertIn("withTimeout(library.exportRealAudio(currentClip.id),120_000)",player)
        self.assertIn("withTimeout(lib.listJourney(),HISTORY_DISK_SCAN_TIMEOUT_MS)",player)
        self.assertIn("withTimeout(lib.recoverLocalMetadata(),HISTORY_DISK_SCAN_TIMEOUT_MS)",player)

    def test_player_shows_only_real_android_health_warnings(self):
        player=(ROOT/"src/routes/index.tsx").read_text()
        self.assertIn("significantPlayerHealthAlerts(health)",player)
        self.assertIn("getNativePerformanceSnapshot()",player)
        self.assertIn('aria-label="Состояние устройства Android"',player)

    def test_history_export_does_not_use_short_default_timeout(self):
        history=(ROOT/"src/routes/history.tsx").read_text()
        self.assertIn('execute(()=>library.exportRealAudio(c.id),"Файл сохранён на телефон",true,120000)',history)
        self.assertIn("withTimeout(action(),timeoutMs)",history)
        self.assertIn("if(busyRef.current)return;",history)

if __name__=="__main__":
    unittest.main()
