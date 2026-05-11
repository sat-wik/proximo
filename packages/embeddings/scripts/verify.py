"""
Sanity-check rank tables for a sample of target words.

Run from the project root:
    python packages/embeddings/scripts/verify.py

Prints the top 15 nearest words for each sample target.
Good neighbors = embedding model is working. Bad neighbors = investigate.
"""

import json
import os

SAMPLE_TARGETS = [
    "ocean", "forest", "music", "happy", "apple",
    "thunder", "dance", "fire", "winter", "dog",
    "anger", "bridge", "cloud", "knife", "dream",
    "gold", "shadow", "river", "storm", "smile",
]

RANKS_DIR = "data/ranks"


def main():
    missing = []
    for target in SAMPLE_TARGETS:
        path = f"{RANKS_DIR}/{target}.json"
        if not os.path.exists(path):
            missing.append(target)
            continue

        with open(path) as f:
            ranks: dict[str, int] = json.load(f)

        top15 = sorted(ranks.items(), key=lambda x: x[1])[:15]
        print(f"\n{target.upper()}")
        for word, rank in top15:
            marker = " ←" if word == target else ""
            print(f"  {rank:5d}  {word}{marker}")

    if missing:
        print(f"\nMISSING rank files for: {missing}")
        print("Run precompute.py first.")


if __name__ == "__main__":
    main()
