#!/usr/bin/env python3
"""Assemble real CI outputs ONLY when exact hashes are independently reviewed.

The review directory contains the reviewed manifest and local license/bank
evidence. This script never creates approvals or downloads on a phone.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def assemble(args):
    review=args.review.resolve()
    data=json.loads(review.read_text(encoding="utf-8"))
    if (data.get("schemaVersion")!=1 or data.get("model")!="haster/Fermata-0.2B-v1"
        or data.get("runtime")!="Alibaba/MNN" or not data.get("reviewedBy")
        or not data.get("reviewedAt") or not isinstance(data.get("files"),list)):
        raise ValueError("An independent complete review manifest is required")
    target=Path("offline-music").resolve()
    if target.exists():
        raise ValueError("Refusing to overwrite an existing music bundle")
    seen=set()
    with tempfile.TemporaryDirectory(prefix="reviewed-music-",dir=target.parent) as temp:
        root=Path(temp)/"offline-music"
        root.mkdir()
        for item in data["files"]:
            name=item["path"]
            relative=PurePosixPath(name)
            if (not name or relative.is_absolute() or ".." in relative.parts or
                "\\" in name or ":" in name or name in seen or
                relative.as_posix()!=name or name=="manifest.json"):
                raise ValueError("Invalid reviewed asset path")
            seen.add(name)
            if item.get("license")!="Apache-2.0":
                raise ValueError("Strict license restriction: "+name)
            role=item["role"]
            if role=="model" and name.startswith("model/"):
                source=args.conversion/name[len("model/"):]
            elif role=="tokenizer":
                source=args.conversion/name
            elif role=="mnn-arm64" and name=="libsoundworld_fermata_mnn.so":
                source=args.mnn
            elif role=="synth-arm64" and name=="libsoundworld_sonivox.so":
                source=args.synth
            elif role in ("notice","soundbank"):
                source=review.parent/name
            else:
                raise ValueError("Unknown reviewed asset role/path: "+name)
            if not source.is_file() or source.stat().st_size!=item["sizeBytes"] or digest(source)!=item["sha256"]:
                raise ValueError("Build output differs from reviewed asset: "+name)
            dest=root/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,dest)
        shutil.copyfile(review,root/"manifest.json")
        root.rename(target)
    print("Exact reviewed bundle assembled; runtime generation not verified.")

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ("review","conversion","mnn","synth"):
        p.add_argument("--"+flag,type=Path,required=True)
    assemble(p.parse_args())

if __name__=="__main__":
    main()
