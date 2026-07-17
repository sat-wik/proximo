import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICTIONARY_PATH = join(__dirname, '../../../../data/dictionary.json');

// dictionary.json is frequency-ordered (wordfreq), so a word's index is
// its commonness rank: 0 = most common English word.
let commonnessMap: Map<string, number> | null = null;

async function load(): Promise<Map<string, number>> {
  if (commonnessMap) return commonnessMap;
  const raw = await readFile(DICTIONARY_PATH, 'utf-8');
  const words = JSON.parse(raw) as string[];
  commonnessMap = new Map(words.map((w, i) => [w, i]));
  return commonnessMap;
}

export async function isValid(word: string): Promise<boolean> {
  const dict = await load();
  return dict.has(word.toLowerCase().trim());
}

/** Commonness rank of a word (0 = most common); Infinity if unknown. */
export async function getCommonnessLookup(): Promise<(word: string) => number> {
  const dict = await load();
  return (word: string) => dict.get(word) ?? Infinity;
}

export async function preload(): Promise<void> {
  await load();
}
