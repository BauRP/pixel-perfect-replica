#!/usr/bin/env python3
"""Developer-side export of the actual Fermata checkpoint to Alibaba MNN.

No runtime network, fake weights, generated MIDI or publishing. Requires a
local MNN checkout and its official exporter dependencies. A conversion is
not an Android runtime or a licensed complete offline-music package.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

MODEL = "haster/Fermata-0.2B-v1"
REVISION = "18b6470"
VOCAB_SIZE = 9507

def read_json(path):
    with path.open(encoding="utf-8") as file:
        return json.load(file)

def original_vocabulary(path):
    value = read_json(path)
    # Support a plain token-to-ID dictionary or a dictionary in the
    # standard tokenizer JSON model.vocab field. Never renumber IDs.
    if isinstance(value, dict) and isinstance(value.get("model"), dict):
        value = value["model"].get("vocab")
    elif isinstance(value, dict) and isinstance(value.get("vocab"), dict):
        value = value["vocab"]
    if not isinstance(value, dict) or len(value) != VOCAB_SIZE:
        raise ValueError("Unknown original vocabulary format or size")
    if any(not isinstance(k, str) or not k or type(v) is not int for k,v in value.items()):
        raise ValueError("Invalid original token mapping")
    if set(value.values()) != set(range(VOCAB_SIZE)):
        raise ValueError("Original token IDs are not a complete bijection")
    if not {"<BOS>", "<PLAN>", "<PLAN_END>", "<TRACK_0>"} <= value.keys():
        raise ValueError("Missing original Fermata musical tokens")
    return value

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()

def run(args):
    from huggingface_hub import HfApi, snapshot_download
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import PreTrainedTokenizerFast
    source = args.mnn_source.resolve()
    exporter = source / "transformers/llm/export/llmexport.py"
    if not exporter.is_file():
        raise ValueError("Official MNN exporter checkout is required")
    license_path = source / "LICENSE"
    if not license_path.is_file() or not re.search(r"Apache License\s*Version 2\.0", license_path.read_text(), re.I):
        raise ValueError("MNN Apache-2.0 license evidence missing")
    mnn_revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True).strip():
        raise ValueError("MNN source checkout contains tracked modifications")
    info = HfApi().model_info(MODEL, revision=REVISION)
    if not info.sha or not info.sha.startswith(REVISION) or not re.fullmatch(r"[0-9a-f]{40}",info.sha):
        raise ValueError("Wrong upstream Fermata revision")
    if not info.card_data or info.card_data.get("license") != "apache-2.0":
        raise ValueError("Fermata Apache-2.0 license metadata missing")
    checkpoint = Path(snapshot_download(MODEL, revision=info.sha,
        allow_patterns=["README.md", "config.json", "model.safetensors", "tokenizer/*"]))
    config = read_json(checkpoint/"config.json")
    if config.get("model_type")!="llama" or config.get("vocab_size")!=VOCAB_SIZE:
        raise ValueError("Unexpected model architecture")
    original = checkpoint/"tokenizer/vocab.json"
    if not original.is_file():
        raise ValueError("Original tokenizer/vocab.json was not found")
    vocab = original_vocabulary(original)
    unknown = next((name for name in ("<UNK>","<unk>","[UNK]") if name in vocab),None)
    if unknown is None:
        raise ValueError("Original unknown token not identified")
    if config.get("bos_token_id") != vocab["<BOS>"]:
        raise ValueError("Checkpoint and tokenizer BOS mismatch")
    weights = checkpoint/"model.safetensors"
    if not weights.is_file() or weights.stat().st_size < 300_000_000:
        raise ValueError("Full original Fermata weights are missing")
    output = args.output.resolve()
    if output.exists():
        raise ValueError("Output already exists; use a new directory")
    output.mkdir(parents=True)
    model = output/"hf-model"
    model.mkdir()
    for name in ("config.json","model.safetensors"):
        shutil.copy2(checkpoint/name,model/name)
    # Compatibility wrapper for the export tool, not a replacement musical
    # codec. Atomic strings map to the author's exact original integer IDs.
    tok = Tokenizer(models.WordLevel(vocab=vocab,unk_token=unknown))
    tok.pre_tokenizer = pre_tokenizers.WhitespaceSplit()
    reverse = {index: token for token,index in vocab.items()}
    eos = config.get("eos_token_id")
    if isinstance(eos,list):
        eos = eos[0] if eos else None
    if type(eos) is not int or eos not in reverse:
        raise ValueError("Original EOS not identified")
    wrapped = PreTrainedTokenizerFast(tokenizer_object=tok,unk_token=unknown,
        bos_token="<BOS>",eos_token=reverse[eos])
    wrapped.save_pretrained(model)
    if any(wrapped.convert_tokens_to_ids(name)!=index for name,index in vocab.items()):
        raise ValueError("Export tokenizer changed original IDs")
    mnn = output/"mnn"
    command = [sys.executable,str(exporter),"--path",str(model),"--export","mnn",
        "--dst_path",str(mnn),"--quant_bit","8"]
    if args.mnnconvert:
        command += ["--mnnconvert",str(args.mnnconvert.resolve())]
    subprocess.run(command,cwd=exporter.parent,check=True)
    for name in ("llm.mnn","llm.mnn.weight","config.json","llm_config.json"):
        file=mnn/name
        if not file.is_file() or not file.stat().st_size:
            raise ValueError("Missing MNN conversion output: "+name)
    # Save the exact normalized original mapping for Android encode/decode.
    (mnn/"tokenizer").mkdir(exist_ok=True)
    (mnn/"tokenizer/vocab.json").write_text(json.dumps(vocab,ensure_ascii=False),encoding="utf-8")
    shutil.copy2(checkpoint/"README.md",output/"FERMATA_UPSTREAM_README.md")
    shutil.copy2(license_path,output/"MNN_LICENSE")
    inventory = {p.relative_to(mnn).as_posix():{"sha256":sha256(p),"sizeBytes":p.stat().st_size}
                 for p in sorted(mnn.rglob("*")) if p.is_file()}
    (output/"conversion.json").write_text(json.dumps({"model":MODEL,"revision":info.sha,
        "mnnRevision":mnn_revision,"quantBits":8,"sourceVocabSha256":sha256(original),
        "sourceWeightsSha256":sha256(weights),"files":inventory,
        "androidInferenceVerified":False},indent=2),encoding="utf-8")
    print("MNN conversion files produced; Android inference not yet verified:",mnn)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mnn-source",type=Path,required=True)
    parser.add_argument("--mnnconvert",type=Path)
    parser.add_argument("--output",type=Path,required=True)
    run(parser.parse_args())

if __name__=="__main__":
    main()
