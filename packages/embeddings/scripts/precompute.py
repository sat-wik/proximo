"""
Precompute per-target rank tables for every word in the dictionary.

Run from the project root AFTER running curate-words.py:
    python packages/embeddings/scripts/precompute.py

Outputs:
    data/ranks/{targetWord}.json   — maps word → rank (1 = target itself)

Skips targets that already have a rank file (safe to resume after interruption).
On Apple Silicon this takes ~5–15 minutes for 3,000 targets.
"""

import json
import os
import time
import numpy as np
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

RANKS_DIR = "data/ranks"
BATCH_SIZE = 64   # targets processed per similarity batch
EMBED_BATCH = 512  # words encoded per inference call


def load_json(path: str):
    with open(path) as f:
        return json.load(f)


def cosine_similarity_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Compute cosine similarities: a (m, d) × b (n, d) → (m, n)."""
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-10)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-10)
    return a_norm @ b_norm.T


def main():
    if not os.path.exists("data/dictionary.json"):
        raise FileNotFoundError("data/dictionary.json not found. Run curate-words.py first.")
    if not os.path.exists("data/targets.json"):
        raise FileNotFoundError("data/targets.json not found. Run curate-words.py first.")

    dictionary: list[str] = load_json("data/dictionary.json")
    targets: list[str] = load_json("data/targets.json")

    os.makedirs(RANKS_DIR, exist_ok=True)

    already_done = {
        t for t in targets if os.path.exists(f"{RANKS_DIR}/{t}.json")
    }
    remaining = [t for t in targets if t not in already_done]

    print(f"Dictionary: {len(dictionary)} words")
    print(f"Targets: {len(targets)} total, {len(already_done)} already computed, {len(remaining)} remaining")

    if not remaining:
        print("All rank files already exist. Nothing to do.")
        return

    print("\nLoading model: sentence-transformers/all-MiniLM-L6-v2 ...")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    print(f"\nEncoding {len(dictionary)} dictionary words (this takes ~1 minute)...")
    t0 = time.time()
    dict_embeddings = model.encode(
        dictionary,
        batch_size=EMBED_BATCH,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=False,
    )
    print(f"Encoded in {time.time() - t0:.1f}s — shape: {dict_embeddings.shape}")

    # Build a word → index map so we can look up target embeddings cheaply
    word_to_idx = {w: i for i, w in enumerate(dictionary)}

    target_indices = []
    missing_targets = []
    for t in remaining:
        if t in word_to_idx:
            target_indices.append(word_to_idx[t])
        else:
            # Target isn't in the dictionary — unusual, but log and skip
            missing_targets.append(t)

    if missing_targets:
        print(f"\nWARNING: {len(missing_targets)} targets not in dictionary (skipping):")
        print(missing_targets[:10])

    target_embeddings = dict_embeddings[target_indices]
    remaining_valid = [remaining[i] for i, t in enumerate(remaining) if t in word_to_idx]

    print(f"\nComputing rank tables for {len(remaining_valid)} targets...")
    t0 = time.time()

    for batch_start in tqdm(range(0, len(remaining_valid), BATCH_SIZE)):
        batch_targets = remaining_valid[batch_start : batch_start + BATCH_SIZE]
        batch_embs = target_embeddings[batch_start : batch_start + BATCH_SIZE]

        # (batch, dict_size)
        sims = cosine_similarity_matrix(batch_embs, dict_embeddings)

        for i, target in enumerate(batch_targets):
            row = sims[i]
            # argsort descending — rank 1 = highest similarity (the target itself)
            ranked_indices = np.argsort(-row)
            ranks = {dictionary[idx]: int(rank + 1) for rank, idx in enumerate(ranked_indices)}

            out_path = f"{RANKS_DIR}/{target}.json"
            with open(out_path, "w") as f:
                json.dump(ranks, f, separators=(",", ":"))

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s ({elapsed / max(len(remaining_valid), 1):.2f}s per target)")
    print(f"Rank files written to {RANKS_DIR}/")


if __name__ == "__main__":
    main()
