#!/usr/bin/env python3
"""Invoke MNN on actual Fermata atomic IDs, on developer/build host only."""
import argparse
import json
from pathlib import Path
import time
from prepare_fermata_mnn import original_vocabulary

HEADER = ("<BOS>", "<GENRE_popular>", "<ENSEMBLE_band>", "<TEMPO_130>",
          "<KEY_0:minor>", "<METER_4/4>", "<PLAN>", "<TRACK_30>",
          "<TRACK_29>", "<TRACK_33>", "<DRUM_TRACK>", "<PLAN_END>")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model",type=Path)
    parser.add_argument("--output",type=Path,required=True)
    args = parser.parse_args()
    model = args.model.resolve()
    vocab = original_vocabulary(model/"tokenizer/vocab.json")
    ids = [vocab[t] for t in HEADER]
    by_id = {v:k for k,v in vocab.items()}
    for name in ("llm.mnn","llm.mnn.weight","llm_config.json","config.json"):
        if not (model/name).is_file() or not (model/name).stat().st_size:
            raise ValueError("Converted weights missing: "+name)
    import MNN.llm as llm
    runtime = llm.create(str(model/"config.json"))
    if not runtime.set_config({"backend_type":"cpu","thread_num":2,"max_new_tokens":512,
        "sampler_type":"mixed","mixed_samplers":["penalty","topK","temperature"],
        "top_k":24,"temperature":0.7,"repetition_penalty":1.12,"frequency_penalty":0.0,
        "timeout_ms":110000}):
        raise RuntimeError("MNN refused numeric inference configuration")
    runtime.load()
    runtime.generate_init()
    start = time.monotonic()
    # MNN 3.6.1's public Python generate(ids) passes zero as max_new_tokens.
    # The pinned native binding accepts the second argument explicitly.
    result = list(runtime._c_obj.generate(ids,512))
    # MNN versions can return generated IDs only or the prompt plus output.
    if result[:len(ids)] == ids:
        result = result[len(ids):]
    if not result or len(result)>512 or any(type(i) is not int or i not in by_id for i in result):
        raise ValueError("No valid generated original IDs from real MNN inference")
    tokens = [by_id[i] for i in result]
    if not any(t not in HEADER and t not in ("<EOS>","<PAD>","<UNK>") for t in tokens):
        raise ValueError("MNN did not produce musical continuation tokens")
    args.output.write_text(json.dumps({"generatedTokenIds":result,
        "generatedTokens":tokens,"elapsedSeconds":round(time.monotonic()-start,3),
        "androidInferenceVerified":False,"audioGenerated":False},ensure_ascii=False,indent=2),encoding="utf-8")
if __name__=="__main__":
    main()
