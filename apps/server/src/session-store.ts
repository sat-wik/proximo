import { randomUUID } from 'node:crypto';
import { readFileSync, writeFile } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import type { GameState } from '@closer/shared';
import type { BotState } from './game/bot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(__dirname, '../../../data/sessions.json');

const MAX_SESSIONS = 5000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const FINISHED_TTL_MS = 10 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 2000;
const PERSIST_ENABLED = process.env.PERSIST_SESSIONS !== '0';

export interface Session {
  id: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  createdAt: number;
  targetWord?: string;
  gameState?: GameState;
  quickMatch?: boolean;
  bot?: BotState | null;
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
    const cutoff = Date.now() - SESSION_TTL_MS;
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

let persistTimer: NodeJS.Timeout | null = null;

function flush(): void {
  persistTimer = null;
  const records: PersistedSession[] = [];
  for (const s of sessions.values()) {
    // Bot games can't be resumed after a restart (timers and strategy state
    // are gone), so persisting them would strand the human on the bot's turn.
    if (s.bot) continue;
    records.push({ id: s.id, createdAt: s.createdAt, targetWord: s.targetWord, gameState: s.gameState });
  }
  writeFile(SESSIONS_FILE, JSON.stringify(records), () => {/* fire-and-forget */});
}

function persist(): void {
  if (!PERSIST_ENABLED || persistTimer) return;
  persistTimer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
}

const sessions = load();

export function createSession(opts?: { quickMatch?: boolean }): Session | null {
  if (sessions.size >= MAX_SESSIONS) return null;
  const id = randomUUID();
  const session: Session = { id, host: null, guest: null, createdAt: Date.now(), quickMatch: opts?.quickMatch };
  sessions.set(id, session);
  persist();
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  const session = sessions.get(id);
  if (session?.bot?.timer) clearTimeout(session.bot.timer);
  sessions.delete(id);
  persist();
}

export function touchSession(_id: string): void {
  persist();
}

// Prune stale sessions; finished matches go sooner to free memory under load
setInterval(() => {
  const now = Date.now();
  let pruned = false;
  for (const [id, session] of sessions) {
    const ttl = session.gameState?.phase === 'match-over' ? FINISHED_TTL_MS : SESSION_TTL_MS;
    if (session.createdAt < now - ttl) {
      if (session.bot?.timer) clearTimeout(session.bot.timer);
      sessions.delete(id);
      pruned = true;
    }
  }
  if (pruned) persist();
}, 15 * 60 * 1000);

process.on('SIGTERM', () => {
  if (persistTimer) clearTimeout(persistTimer);
  if (PERSIST_ENABLED) flush();
});
