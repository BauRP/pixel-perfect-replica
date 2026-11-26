#!/usr/bin/env python3
"""Developer-side export of the actual Fermata checkpoint to Alibaba MNN.

No runtime network, fake weights, generated MIDI or publishing. Requires a
local MNN checkout and its official exporter dependencies. A conversion is
not an Android runtime or a licensed complete offline-music package.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

MODEL = "haster/Fermata-0.2B-v1"
REVISION = "18b647098f579ee41db67c0ad4c7f7f39ce0eac1"
ORIGINAL_VOCAB_SHA256 = "40ac92aa8a3683693e2bf725d46cf8a4825221185ed29a7fcec550deacf81224"
ORIGINAL_BPE_SHA256 = "edd9083af2f7c4aa34efdd0df41ef46c8f424db34d35522d7107c489a6ea1a09"
VOCAB_SIZE = 9507
BPE_MERGE_COUNT = 7348
BASE_TOKEN_COUNT = 1981
BOUNDARY_TOKEN_COUNT = 174

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

def build_codec_manifest(vocab, bpe):
    """Preserve the exact upstream REMI+ inventory without inventing its decoder."""
    if (not isinstance(vocab,dict) or len(vocab)!=VOCAB_SIZE or
        set(vocab.values())!=set(range(VOCAB_SIZE))):
        raise ValueError("Original vocabulary is not a complete ID mapping")
    if not isinstance(bpe, dict):
        raise ValueError("Original Fermata BPE metadata is not an object")
    merges=bpe.get("merges")
    symbols=bpe.get("symbols")
    base=bpe.get("base_tokens")
    boundary=bpe.get("boundary_tokens")
    rust=bpe.get("rust_tokens")
    if (not isinstance(merges,list) or len(merges)!=BPE_MERGE_COUNT or
        not isinstance(symbols,list) or len(symbols)!=BPE_MERGE_COUNT or
        not isinstance(base,list) or len(base)!=BASE_TOKEN_COUNT or
        not isinstance(boundary,list) or len(boundary)!=BOUNDARY_TOKEN_COUNT or
        not isinstance(rust,dict) or len(rust)!=BPE_MERGE_COUNT):
        raise ValueError("Original Fermata BPE metadata shape mismatch")
    for name,items in (("symbols",symbols),("base_tokens",base),("boundary_tokens",boundary)):
        if any(not isinstance(item,str) or not item for item in items):
            raise ValueError("Invalid original BPE "+name)
        if len(set(items))!=len(items):
            raise ValueError("Duplicate original BPE "+name)
    if any(not isinstance(pair,list) or len(pair)!=2 or
           any(not isinstance(part,str) or not part for part in pair)
           for pair in merges):
        raise ValueError("Invalid original BPE merge pair")
    if set(rust)!=set(symbols) or any(not isinstance(value,str) or not value for value in rust.values()):
        raise ValueError("Original BPE Rust symbol map mismatch")
    if not set(base)<=vocab.keys() or not set(boundary)<=vocab.keys() or not set(symbols)<=vocab.keys():
        raise ValueError("BPE references tokens missing from original vocabulary")
    tokens_by_id=[None]*VOCAB_SIZE
    families={}
    for token,token_id in vocab.items():
        tokens_by_id[token_id]=token
        match=re.match(r"^<([A-Z][A-Z0-9]*)(?:_|:|>)",token)
        if match:
            families.setdefault(match.group(1),[]).append({"token":token,"id":token_id})
    if any(token is None for token in tokens_by_id):
        raise ValueError("Original token IDs are not contiguous")
    return {
        "schemaVersion":1,
        "model":MODEL,
        "revision":REVISION,
        "codec":"bar-major REMI+",
        "vocabularySize":VOCAB_SIZE,
        "ticksPerQuarter":24,
        "contextLengthTokens":4096,
        "trainingWindowTokens":2048,
        "tokenizationForCheckpoint":"atomic",
        "bpeMergesAppliedDuringTraining":False,
        "originalVocabularySha256":ORIGINAL_VOCAB_SHA256,
        "originalBpeSha256":ORIGINAL_BPE_SHA256,
        "bpeMetadata":{
            "mergeCount":len(merges),"symbolCount":len(symbols),
            "baseTokenCount":len(base),"boundaryTokenCount":len(boundary),
        },
        "knownCheckpointIssues":{
            "drumPitchOffset":-1,
            "drumPitchCorrectionApplied":False,
            "note":"Upstream model card reports a +1 GM drum-key shift; subtracting one recovers most hits. Apply only in a reviewed decoder.",
        },
        "decoderStatus":"not-implemented",
        "families":families,
        "tokensById":tokens_by_id,
    }

def write_mnn_atomic_tokenizer(path, vocab, config):
    """MNN v3.6.1 tokenizer type 1, used only for numerical token inference.

    The original music codec stays separate. Never invoke MNN text encoding
    for musical headers. Header layout follows MNN utils/tokenizer.py.
    """
    eos = config.get("eos_token_id")
    stops = eos if isinstance(eos, list) else [eos]
    if not stops or any(type(i) is not int or not 0 <= i < VOCAB_SIZE for i in stops):
        raise ValueError("Invalid original EOS identifiers")
    stops = list(dict.fromkeys(stops))
    special = sorted(set(stops + [vocab["<BOS>"]]))
    with path.open("w", encoding="utf-8", newline="\n") as file:
        file.write(f"430 1\n{len(special)} {len(stops)} 0\n")
        file.write(" ".join(map(str, special + stops)) + "\n")
        file.write(str(len(vocab)) + "\n")
        for token, _ in sorted(vocab.items(), key=lambda pair: pair[1]):
            file.write(base64.b64encode(token.encode("utf-8")).decode("ascii") + "\n")
    # Prove byte-for-byte roundtrip and exact stop list, not a new codec.
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) != VOCAB_SIZE + 4 or lines[0] != "430 1":
        raise ValueError("Incomplete MNN tokenizer export")
    for index, encoded in enumerate(lines[4:]):
        token = base64.b64decode(encoded, validate=True).decode("utf-8")
        if vocab.get(token) != index:
            raise ValueError("MNN export changed original token ID")
    if list(map(int, lines[2].split())) != special + stops:
        raise ValueError("MNN export changed original stop tokens")

def run(args):
    from huggingface_hub import HfApi, snapshot_download
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import PreTrainedTokenizerFast
    source = args.mnn_source.resolve()
    exporter = source / "transformers/llm/export/llmexport.py"
    if not exporter.is_file():
        raise ValueError("Official MNN exporter checkout is required")
    license_path = source / "LICENSE.txt"
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
        allow_patterns=["README.md", "config.json", "tokenizer/*"]))
    config = read_json(checkpoint/"config.json")
    if config.get("model_type")!="llama" or config.get("vocab_size")!=VOCAB_SIZE:
        raise ValueError("Unexpected model architecture")
    original = checkpoint/"tokenizer/vocab.json"
    if not original.is_file():
        raise ValueError("Original tokenizer/vocab.json was not found")
    if sha256(original) != ORIGINAL_VOCAB_SHA256:
        raise ValueError("Original Fermata vocabulary checksum differs from pinned revision")
    vocab = original_vocabulary(original)
    original_bpe=checkpoint/"tokenizer/bpe.json"
    if not original_bpe.is_file() or sha256(original_bpe)!=ORIGINAL_BPE_SHA256:
        raise ValueError("Original Fermata BPE checksum differs from pinned revision")
    bpe=read_json(original_bpe)
    codec_manifest=build_codec_manifest(vocab,bpe)
    # Actual upstream inventory contains PAD but no UNK. The HF exporter
    # requires an existing fallback ID; only its compatibility text wrapper
    # uses PAD. The production numerical encoder rejects unknown strings.
    unknown = next((name for name in ("<UNK>","<unk>","[UNK]") if name in vocab),"<PAD>")
    if unknown not in vocab:
        raise ValueError("Original export fallback ID not identified")
    if config.get("bos_token_id") != vocab["<BOS>"]:
        raise ValueError("Checkpoint and tokenizer BOS mismatch")
    checkpoint = Path(snapshot_download(MODEL, revision=info.sha,
        allow_patterns=["model.safetensors"]))
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
    # Official exporter emits tokenizer.mtok for tokenizer.json; its
    # generic text-tokenizer probes can also add the unknown ID as EOS.
    # The numeric musical pipeline needs only the exact original ID table.
    write_mnn_atomic_tokenizer(mnn/"tokenizer.txt",vocab,config)
    runtime_config=read_json(mnn/"config.json")
    runtime_config["tokenizer_file"]="tokenizer.txt"
    (mnn/"config.json").write_text(json.dumps(runtime_config,indent=2),encoding="utf-8")
    alternate=mnn/"tokenizer.mtok"
    if alternate.is_file():
        alternate.unlink()
    for name in ("llm.mnn","llm.mnn.weight","config.json","llm_config.json","tokenizer.txt",
                 "tokenizer/vocab.json","tokenizer/bpe.json","tokenizer/codec.json"):
        file=mnn/name
        if not file.is_file() or not file.stat().st_size:
            raise ValueError("Missing MNN conversion output: "+name)
    # Save the exact normalized original mapping for Android encode/decode.
    (mnn/"tokenizer").mkdir(exist_ok=True)
    (mnn/"tokenizer/vocab.json").write_text(json.dumps(vocab,ensure_ascii=False),encoding="utf-8")
    shutil.copy2(original_bpe,mnn/"tokenizer/bpe.json")
    (mnn/"tokenizer/codec.json").write_text(
        json.dumps(codec_manifest,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    shutil.copy2(checkpoint/"README.md",output/"FERMATA_UPSTREAM_README.md")
    shutil.copy2(license_path,output/"MNN_LICENSE")
    inventory = {p.relative_to(mnn).as_posix():{"sha256":sha256(p),"sizeBytes":p.stat().st_size}
                 for p in sorted(mnn.rglob("*")) if p.is_file()}
    (output/"conversion.json").write_text(json.dumps({"model":MODEL,"revision":info.sha,
        "mnnRevision":mnn_revision,"quantBits":8,"sourceVocabSha256":sha256(original),
        "sourceWeightsSha256":sha256(weights),"sourceBpeSha256":ORIGINAL_BPE_SHA256,
        "codecManifestSha256":sha256(mnn/"tokenizer/codec.json"),"files":inventory,
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
