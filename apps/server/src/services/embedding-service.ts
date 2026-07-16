import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RANKS_DIR = join(__dirname, '../../../../data/ranks');
const RANKS_BUCKET_URL = process.env.RANKS_BUCKET_URL; // e.g. "https://pub-xxx.r2.dev"

// LRU cache: keep the last N loaded targets in memory.
// Each rank table is ~300 KB; 100 tables ≈ 30 MB.
const MAX_CACHE_SIZE = 100;
const cache = new Map<string, Promise<Record<string, number>>>();
const byRankCache = new Map<string, string[]>();

function loadTarget(target: string): Promise<Record<string, number>> {
  const cached = cache.get(target);
  if (cached) {
    // Re-insert so eviction approximates LRU rather than FIFO
    cache.delete(target);
    cache.set(target, cached);
    return cached;
  }

  if (cache.size >= MAX_CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }

  // Cache the in-flight promise so concurrent lookups share one load
  const loading = (async () => {
    if (RANKS_BUCKET_URL) {
      const res = await fetch(`${RANKS_BUCKET_URL}/ranks/${target}.json`);
      if (!res.ok) throw new Error(`R2 fetch failed: HTTP ${res.status} for ${target}`);
      return await res.json() as Record<string, number>;
    }
    const path = join(RANKS_DIR, `${target}.json`);
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Record<string, number>;
  })();

  cache.set(target, loading);
  loading.catch(() => cache.delete(target));
  return loading;
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

/** Dense array where index r-1 holds the word at rank r. Built once per target. */
export async function getWordsByRank(target: string): Promise<string[]> {
  const cached = byRankCache.get(target);
  if (cached) return cached;

  const ranks = await loadTarget(target);
  const byRank: string[] = [];
  for (const [word, rank] of Object.entries(ranks)) {
    byRank[rank - 1] = word;
  }

  if (byRankCache.size >= MAX_CACHE_SIZE) {
    byRankCache.delete(byRankCache.keys().next().value!);
  }
  byRankCache.set(target, byRank);
  return byRank;
}

/** Warm the cache for a given target before the round starts. */
export async function warmCache(target: string): Promise<void> {
  await loadTarget(target);
}
