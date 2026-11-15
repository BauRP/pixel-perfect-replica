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

    def test_history_export_does_not_use_short_default_timeout(self):
        history=(ROOT/"src/routes/history.tsx").read_text()
        self.assertIn('execute(()=>library.exportRealAudio(c.id),"Файл сохранён на телефон",true,120000)',history)
        self.assertIn("withTimeout(action(),timeoutMs)",history)
        self.assertIn("if(busyRef.current)return;",history)

if __name__=="__main__":
    unittest.main()
