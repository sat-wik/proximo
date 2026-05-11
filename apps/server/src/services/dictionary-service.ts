import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICTIONARY_PATH = join(__dirname, '../../../../data/dictionary.json');

let dictionarySet: Set<string> | null = null;

async function load(): Promise<Set<string>> {
  if (dictionarySet) return dictionarySet;
  const raw = await readFile(DICTIONARY_PATH, 'utf-8');
  dictionarySet = new Set(JSON.parse(raw) as string[]);
  return dictionarySet;
}

export async function isValid(word: string): Promise<boolean> {
  const dict = await load();
  return dict.has(word.toLowerCase().trim());
}

export async function preload(): Promise<void> {
  await load();
}
