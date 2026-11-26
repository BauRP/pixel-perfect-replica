import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import patch_mnn_wheel_execstack as patcher


class MnnWheelExecStackTests(unittest.TestCase):
    def test_parses_executable_and_non_executable_stack_flags(self):
        self.assertEqual(patcher.parse_gnu_stack_flags(
            "Program Headers:\n  GNU_STACK 0x0 0x0 0x0 0x0 0x0 RWE 0x10\n"), "RWE")
        self.assertEqual(patcher.parse_gnu_stack_flags(
            "Program Headers:\n  GNU_STACK 0x0 0x0 0x0 0x0 0x0 RW 0x10\n"), "RW")

    def test_rejects_missing_or_malformed_gnu_stack(self):
        with self.assertRaises(ValueError):
            patcher.parse_gnu_stack_flags("Program Headers:\n  LOAD 0x0\n")
        with self.assertRaises(ValueError):
            patcher.parse_gnu_stack_flags("GNU_STACK 0x0 0x0")

    def test_patches_only_mnn_owned_objects_and_verifies_the_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "_mnncengine.cpython-311-x86_64-linux-gnu.so").write_bytes(b"mnn")
            (root / "MNN").mkdir()
            (root / "MNN" / "libmnn.so").write_bytes(b"mnn")
            (root / "unrelated.so").write_bytes(b"not-mnn")
            def flags(path, readelf="readelf"):
                return "RWE" if path.name.startswith("_mnncengine") else "RW"
            with patch.object(patcher, "read_stack_flags", side_effect=flags), \
                 patch.object(patcher.subprocess, "run") as run:
                changed = patcher.patch_mnn_shared_objects(root)
            self.assertEqual(changed, 1)
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0][0:2], ["patchelf", "--clear-execstack"])
            self.assertIn("_mnncengine", run.call_args.args[0][2])

    def test_fails_if_patchelf_does_not_clear_the_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "_mnncengine.so").write_bytes(b"mnn")
            with patch.object(patcher, "read_stack_flags", return_value="RWE"), \
                 patch.object(patcher.subprocess, "run"):
                with self.assertRaisesRegex(ValueError, "still requests executable stack"):
                    patcher.patch_mnn_shared_objects(root)


if __name__ == "__main__":
    unittest.main()
