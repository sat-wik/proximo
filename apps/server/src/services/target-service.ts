import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = join(__dirname, '../../../../data/targets.json');

let targets: string[] | null = null;

async function load(): Promise<string[]> {
  if (targets) return targets;
  const raw = await readFile(TARGETS_PATH, 'utf-8');
  targets = JSON.parse(raw) as string[];
  return targets;
}

export async function getDailyTarget(): Promise<string> {
  const pool = await load();
  const utcDay = Math.floor(Date.now() / 86_400_000);
  return pool[utcDay % pool.length];
}

export async function getRandomTarget(exclude: string[] = []): Promise<string> {
  const pool = await load();
  const excludeSet = new Set(exclude);
  const available = pool.filter((t) => !excludeSet.has(t));
  const source = available.length > 0 ? available : pool;
  return source[Math.floor(Math.random() * source.length)];
}

export async function preload(): Promise<void> {
  await load();
}
