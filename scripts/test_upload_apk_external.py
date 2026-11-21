import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SPEC=importlib.util.spec_from_file_location("uploader",
    Path(__file__).with_name("upload_apk_external.py"))
module=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

class ExternalApkUploaderTests(unittest.TestCase):
    def test_catbox_url(self):
        self.assertEqual(module.validate_download_url(
            "Catbox","https://files.catbox.moe/real-apk.apk"),
            "https://files.catbox.moe/real-apk.apk")
        self.assertIsNone(module.validate_download_url(
            "Catbox","https://catbox.moe.fake.host/real-apk.apk"))
        self.assertIsNone(module.validate_download_url(
            "Catbox","http://files.catbox.moe/real-apk.apk"))
    def test_litterbox_and_fileio(self):
        self.assertEqual(module.validate_download_url(
            "Litterbox","https://litter.catbox.moe/generated.apk"),
            "https://litter.catbox.moe/generated.apk")
        self.assertEqual(module.validate_download_url(
            "File.io",json.dumps({"success":True,"link":"https://file.io/ABC123"})),
            "https://file.io/ABC123")
        self.assertIsNone(module.validate_download_url(
            "File.io",json.dumps({"success":False,"link":"https://file.io/ABC123"})))
    def test_missing_apk_never_uploaded(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,"No verified APK"):
                module.deliver(Path(d)/"missing.apk")
    def test_skip_oversized_catbox_and_try_litterbox(self):
        with tempfile.TemporaryDirectory() as d:
            apk=Path(d)/"soundworld-ar-debug.apk"
            apk.write_bytes(b"apk")
            with patch.object(Path,"stat") as stat:
                stat.return_value=SimpleNamespace(st_size=module.CATBOX_MAX+1)
                with patch.object(module.subprocess,"run") as cmd:
                    cmd.return_value=SimpleNamespace(returncode=0,stdout="https://litter.catbox.moe/test.apk")
                    self.assertIsNone(module.try_upload(apk,module.PROVIDERS[0]))
                    self.assertEqual(module.try_upload(apk,module.PROVIDERS[1]),
                        "https://litter.catbox.moe/test.apk")
                    self.assertEqual(cmd.call_count,1)
    def test_never_accept_untrusted_response(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"soundworld-ar-debug.apk";p.write_bytes(b"x"*1024*1024)
            with patch.object(module.subprocess,"run",return_value=SimpleNamespace(
                returncode=0,stdout="https://attacker.invalid/bad.apk")):
                self.assertIsNone(module.deliver(p))
if __name__=="__main__":
    unittest.main()
