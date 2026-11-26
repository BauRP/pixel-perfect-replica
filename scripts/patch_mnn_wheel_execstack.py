#!/usr/bin/env python3
"""Clear an unsafe executable-stack ELF marker on the official MNN wheel only.

The MNN converter wheel currently ships a native extension with GNU_STACK=RWE.
This changes only the ELF stack permission metadata, then re-reads every
MNN-owned shared object and imports the official converter. It does not patch
application libraries or download model/runtime assets.
"""
from pathlib import Path
import argparse
import subprocess


def parse_gnu_stack_flags(output: str) -> str:
    line = next((row for row in output.splitlines()
                 if row.split() and row.split()[0] == "GNU_STACK"), None)
    if line is None:
        raise ValueError("ELF has no GNU_STACK program header")
    fields = line.split()
    if len(fields) < 3:
        raise ValueError("Malformed GNU_STACK program header")
    flags = fields[-2]
    if not flags or any(flag not in "RWE" for flag in flags) or "R" not in flags:
        raise ValueError("Unrecognized GNU_STACK flags: " + flags)
    return flags


def read_stack_flags(path: Path, readelf: str = "readelf") -> str:
    result = subprocess.run([readelf, "-lW", str(path)], check=True,
                            capture_output=True, text=True)
    return parse_gnu_stack_flags(result.stdout)


def find_mnn_shared_objects(site_packages: Path) -> list[Path]:
    root = site_packages.resolve()
    candidates = list(root.glob("_mnncengine*.so"))
    package = root / "MNN"
    if package.is_dir():
        candidates.extend(package.rglob("*.so"))
    return sorted({path.resolve() for path in candidates if path.is_file()})


def patch_mnn_shared_objects(site_packages: Path, patchelf: str = "patchelf",
                             readelf: str = "readelf") -> int:
    targets = find_mnn_shared_objects(site_packages)
    if not targets:
        raise ValueError("Official MNN converter shared objects were not found")
    changed = 0
    for path in targets:
        flags = read_stack_flags(path, readelf)
        if "E" in flags:
            subprocess.run([patchelf, "--clear-execstack", str(path)],
                           check=True, capture_output=True, text=True)
            changed += 1
            flags = read_stack_flags(path, readelf)
        if "E" in flags:
            raise ValueError("MNN shared object still requests executable stack: " + path.name)
        print("Verified non-executable GNU_STACK:", path.name, flags)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-packages", type=Path, required=True)
    parser.add_argument("--patchelf", default="patchelf")
    parser.add_argument("--readelf", default="readelf")
    args = parser.parse_args()
    changed = patch_mnn_shared_objects(args.site_packages, args.patchelf, args.readelf)
    print("MNN wheel ELF stack metadata verified; patched:", changed)


if __name__ == "__main__":
    main()
