import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RANKS_DIR = join(__dirname, '../../../../data/ranks');
const RANKS_BUCKET_URL = process.env.RANKS_BUCKET_URL; // e.g. "https://pub-xxx.r2.dev"

// LRU-style cache: keep the last N loaded targets in memory.
// Each rank table is ~300 KB; 30 tables ≈ 9 MB.
const MAX_CACHE_SIZE = 30;
const cache = new Map<string, Record<string, number>>();

async function loadTarget(target: string): Promise<Record<string, number>> {
  if (cache.has(target)) return cache.get(target)!;

  if (cache.size >= MAX_CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }

  let ranks: Record<string, number>;

  if (RANKS_BUCKET_URL) {
    const res = await fetch(`${RANKS_BUCKET_URL}/ranks/${target}.json`);
    if (!res.ok) throw new Error(`R2 fetch failed: HTTP ${res.status} for ${target}`);
    ranks = await res.json() as Record<string, number>;
  } else {
    const path = join(RANKS_DIR, `${target}.json`);
    const raw = await readFile(path, 'utf-8');
    ranks = JSON.parse(raw) as Record<string, number>;
  }

  cache.set(target, ranks);
  return ranks;
}

/** Returns the rank of `word` relative to `target` (1 = target itself). */
export async function getRank(target: string, word: string): Promise<number | null> {
  try {
    const ranks = await loadTarget(target);
    return ranks[word] ?? null;
  } catch {
    return null;
  }
}

/** Warm the cache for a given target before the round starts. */
export async function warmCache(target: string): Promise<void> {
  await loadTarget(target);
}
