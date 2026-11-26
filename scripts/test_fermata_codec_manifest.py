import unittest

from scripts.prepare_fermata_mnn import (
    VOCAB_SIZE, BPE_MERGE_COUNT, BASE_TOKEN_COUNT, BOUNDARY_TOKEN_COUNT,
    build_codec_manifest,
)


def fixture():
    base = ["<PAD>", "<MASK>", "<INFILL>", "<CONTINUE>", "<BOS>", "<EOS>",
            "<BAR>", "<DRUM_TRACK>", "<PLAN>", "<PLAN_END>", "<TRACK_0>"]
    base += [f"<BASE_{i}>" for i in range(BASE_TOKEN_COUNT-len(base))]
    symbols = [f"<BPE_{i}>" for i in range(BPE_MERGE_COUNT)]
    extras = [f"<EXTRA_{i}>" for i in range(VOCAB_SIZE-len(base)-len(symbols))]
    tokens = base + symbols + extras
    vocab = {token: index for index, token in enumerate(tokens)}
    bpe = {
        "merges": [["a", "b"] for _ in range(BPE_MERGE_COUNT)],
        "symbols": symbols,
        "base_tokens": base,
        "boundary_tokens": base[:BOUNDARY_TOKEN_COUNT],
        "rust_tokens": {symbol: chr(0xE000 + (index % 0x1900)) for index, symbol in enumerate(symbols)},
    }
    return vocab, bpe


class FermataCodecManifestTests(unittest.TestCase):
    def test_preserves_atomic_training_ids_and_known_model_limitations(self):
        vocab, bpe = fixture()
        manifest = build_codec_manifest(vocab, bpe)
        self.assertEqual(manifest["vocabularySize"], 9507)
        self.assertEqual(manifest["ticksPerQuarter"], 24)
        self.assertEqual(manifest["tokenizationForCheckpoint"], "atomic")
        self.assertFalse(manifest["bpeMergesAppliedDuringTraining"])
        self.assertEqual(manifest["bpeMetadata"]["mergeCount"], 7348)
        self.assertEqual(manifest["knownCheckpointIssues"]["drumPitchOffset"], -1)
        self.assertFalse(manifest["knownCheckpointIssues"]["drumPitchCorrectionApplied"])
        self.assertEqual(manifest["decoderStatus"], "not-implemented")
        self.assertEqual(len(manifest["tokensById"]), VOCAB_SIZE)
        self.assertEqual(manifest["tokensById"][0], "<PAD>")

    def test_rejects_changed_bpe_sizes_and_missing_symbols(self):
        vocab, bpe = fixture()
        bpe["vocab_size"] -= 1
        with self.assertRaisesRegex(ValueError, "vocabulary size"):
            build_codec_manifest(vocab, bpe)
        vocab, bpe = fixture()
        bpe["symbols"][0] = "<NOT_IN_VOCAB>"
        with self.assertRaisesRegex(ValueError, "missing from original"):
            build_codec_manifest(vocab, bpe)

    def test_rejects_wrong_merge_and_rust_symbol_counts(self):
        vocab, bpe = fixture()
        bpe["merges"].pop()
        with self.assertRaisesRegex(ValueError, "metadata shape"):
            build_codec_manifest(vocab, bpe)
        vocab, bpe = fixture()
        bpe["rust_tokens"].pop(next(iter(bpe["rust_tokens"])))
        with self.assertRaisesRegex(ValueError, "metadata shape"):
            build_codec_manifest(vocab, bpe)


if __name__ == "__main__":
    unittest.main()
