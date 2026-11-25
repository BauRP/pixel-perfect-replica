#!/usr/bin/env python3
"""Report token families from the genuine upstream vocabulary, not guessed IDs."""
import re
import sys
from collections import defaultdict
from pathlib import Path
from prepare_fermata_mnn import original_vocabulary

def main():
    vocab=original_vocabulary(Path(sys.argv[1]))
    families=defaultdict(list)
    for token,identifier in sorted(vocab.items(),key=lambda pair:pair[1]):
        # Group only by the actual prefix in the source file; this is an
        # inventory, not a proposed decoder or reconstruction of grammar.
        match=re.match(r"^<?([A-Za-z][A-Za-z0-9]*)(?:_|:|>|$)",token)
        families[match.group(1) if match else "other"].append((token,identifier))
    print("## Actual Fermata vocabulary inventory")
    print("Total token IDs:",len(vocab))
    for name,items in sorted(families.items()):
        examples="; ".join(f"{token!r} = {identifier}" for token,identifier in items[:6])
        print(f"- {name}: {len(items)}; {examples}")
if __name__=="__main__":
    main()
