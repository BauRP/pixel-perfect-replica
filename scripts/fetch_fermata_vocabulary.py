#!/usr/bin/env python3
"""Obtain only the authentic original Fermata metadata/tokenizer from HF."""
from pathlib import Path
import re
import sys
from huggingface_hub import HfApi, snapshot_download
from prepare_fermata_mnn import MODEL, REVISION, original_vocabulary, sha256
from report_fermata_vocabulary import main as inventory

def main():
    info=HfApi().model_info(MODEL,revision=REVISION)
    if not info.sha or not re.fullmatch("[0-9a-f]{40}",info.sha) or not info.sha.startswith(REVISION):
        raise ValueError("Original revision not confirmed")
    if not info.card_data or info.card_data.get("license")!="apache-2.0":
        raise ValueError("Original Apache-2.0 model metadata missing")
    root=Path(snapshot_download(MODEL,revision=info.sha,
        allow_patterns=["README.md","config.json","tokenizer/*"]))
    path=root/"tokenizer/vocab.json"
    original_vocabulary(path)
    print("Original revision:",info.sha)
    print("Original vocabulary SHA256:",sha256(path))
    sys.argv=[sys.argv[0],str(path)]
    inventory()

if __name__=="__main__":
    main()
