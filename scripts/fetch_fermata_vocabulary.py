#!/usr/bin/env python3
"""Obtain only the authentic original Fermata metadata/tokenizer from HF."""
from pathlib import Path
import re
import sys
from huggingface_hub import HfApi, snapshot_download
from prepare_fermata_mnn import MODEL, REVISION, ORIGINAL_VOCAB_SHA256, original_vocabulary, sha256
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
    if sha256(path)!=ORIGINAL_VOCAB_SHA256:
        raise ValueError("Original vocabulary checksum changed")
    # Record real small-file metadata in logs, not guessed BPE grammar.
    import json
    config=json.loads((root/"config.json").read_text(encoding="utf-8"))
    print("Original model architecture:",json.dumps({k:config.get(k) for k in
        ("model_type","vocab_size","bos_token_id","eos_token_id","max_position_embeddings")}))
    for file in sorted((root/"tokenizer").glob("*")):
        if file.is_file():
            print("Original tokenizer file:",file.name,file.stat().st_size,sha256(file))
    bpe=root/"tokenizer/bpe.json"
    if bpe.is_file():
        value=json.loads(bpe.read_text(encoding="utf-8"))
        if isinstance(value,dict):
            print("BPE top-level fields:",list(value)[:24])
            for k,v in list(value.items())[:24]:
                if isinstance(v,(list,dict)):
                    sample=v[:2] if isinstance(v,list) else dict(list(v.items())[:2])
                    print("BPE structure:",k,type(v).__name__,len(v),json.dumps(sample,ensure_ascii=False)[:2000])
        elif isinstance(value,list):
            print("BPE list:",len(value),json.dumps(value[:3],ensure_ascii=False)[:2000])
    print("Original revision:",info.sha)
    print("Original vocabulary SHA256:",sha256(path))
    sys.argv=[sys.argv[0],str(path)]
    inventory()

if __name__=="__main__":
    main()
