import { randomUUID } from 'node:crypto';
import { readFileSync, writeFile } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import type { GameState } from '@closer/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, '../../../data/sessions.json');

export interface Session {
  id: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  createdAt: number;
  targetWord?: string;
  gameState?: GameState;
}

interface PersistedSession {
  id: string;
  createdAt: number;
  targetWord?: string;
  gameState?: GameState;
}

function load(): Map<string, Session> {
  try {
    const records = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as PersistedSession[];
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const map = new Map<string, Session>();
    for (const r of records) {
      if (r.createdAt > cutoff) {
        map.set(r.id, { id: r.id, host: null, guest: null, createdAt: r.createdAt, targetWord: r.targetWord, gameState: r.gameState });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function persist(): void {
  const records: PersistedSession[] = [];
  for (const s of sessions.values()) {
    records.push({ id: s.id, createdAt: s.createdAt, targetWord: s.targetWord, gameState: s.gameState });
  }
  writeFile(SESSIONS_FILE, JSON.stringify(records), () => {/* fire-and-forget */});
}

const sessions = load();

export function createSession(): Session {
  const id = randomUUID();
  const session: Session = { id, host: null, guest: null, createdAt: Date.now() };
  sessions.set(id, session);
  persist();
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  sessions.delete(id);
  persist();
}

export function touchSession(_id: string): void {
  persist();
}

// Prune sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  let pruned = false;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) { sessions.delete(id); pruned = true; }
  }
  if (pruned) persist();
}, 15 * 60 * 1000);
