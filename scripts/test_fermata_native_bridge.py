"""Native Fermata package gate: fail closed, never fabricate generated music."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
def src(path):return (ROOT/path).read_text(encoding="utf-8")

class FermataNativeContract(unittest.TestCase):
    def test_registered_and_staged_in_all_workflows(self):
        self.assertIn("registerPlugin(SoundWorldFermataPlugin.class)",
                      src("native/android/MainActivity.java"))
        for path in ("codemagic.yaml",".github/workflows/android_build.yml",
                     ".github/workflows/soundworld-android.yml"):
            self.assertIn("cp native/android/SoundWorldFermataPlugin.java",src(path))
    def test_verified_local_package_not_fake_music(self):
        native=src("native/android/SoundWorldFermataPlugin.java")
        for text in ('offline-music/manifest.json', 'haster/Fermata-0.2B-v1',
                     'Alibaba/MNN', 'generationReady", false',
                     'new ArrayBlockingQueue<>(2)'):
            self.assertIn(text,native)
        self.assertNotIn("HttpURLConnection",native)
        self.assertNotIn("getExternalStorage",native)
    def test_native_libraries_can_be_staged_or_mapped_inside_apk(self):
        native=src("native/android/SoundWorldFermataPlugin.java")
        self.assertIn("nativeLibraryDir",native)
        self.assertIn("new ZipFile(context.getApplicationInfo().sourceDir)",native)
        self.assertIn('apk.getEntry("lib/arm64-v8a/"+fileName)',native)

    def test_adapter_preserves_unavailable_until_real_inference(self):
        adapter=src("src/lib/sw/fermata-native.ts")
        self.assertIn("registerAdapters({engine:",adapter)
        self.assertIn("...unavailableAdapters.engine",adapter)
        self.assertIn('ok:false,code:"UNAVAILABLE"',adapter)
        self.assertIn("generationReady:false",adapter)
        self.assertIn("withNativeDeadline(()=>native.inspect(),2500)",adapter)
    def test_activated_before_router(self):
        main=src("src/native/main.tsx")
        self.assertIn("installNativeFermataAdapter()",main)
        self.assertLess(main.index("installNativeFermataAdapter()"),main.index("createRoot(root)"))

if __name__=="__main__":
    unittest.main()
