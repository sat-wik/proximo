import type { Session } from './session-store.js';
import { createSession, getSession, removeSession } from './session-store.js';
import { attachBot } from './game/bot.js';

const BOT_DELAY_MS = Number(process.env.QUICK_MATCH_BOT_DELAY_MS) || 20_000;

// Single waiting slot: pairing runs synchronously on Node's single thread,
// so the slot is consumed atomically and a FIFO queue adds nothing.
let waiting: string | null = null;

/**
 * Pair with the waiting player if there is one, otherwise open a new
 * quick-match session that a bot will join after the delay elapses.
 * Returns null when the server is at capacity.
 */
export function quickMatch(): { sessionId: string; botDelayMs: number } | null {
  if (waiting) {
    const session = getSession(waiting);
    const stale = !session || session.gameState || session.bot;
    waiting = null;
    if (session && !stale) {
      return { sessionId: session.id, botDelayMs: BOT_DELAY_MS };
    }
  }

  const session = createSession({ quickMatch: true });
  if (!session) return null;
  waiting = session.id;

  // Self-checking timer, never cancelled on pairing: by the time it fires the
  // game may have started with a second human, the waiter may have left, or a
  // paired player may never have connected (in which case the bot rescues
  // whoever is live).
  const sessionId = session.id;
  setTimeout(() => {
    const s = getSession(sessionId);
    if (!s || s.gameState || s.bot) return;
    if (waiting === sessionId) waiting = null;
    if (s.host?.readyState === 1) {
      void attachBot(s);
    } else {
      // Never attach a bot without a live human
      removeSession(sessionId);
    }
  }, BOT_DELAY_MS);

  return { sessionId: session.id, botDelayMs: BOT_DELAY_MS };
}

/** Called when a WebSocket closes: a waiter who leaves gives up their slot. */
export function onSocketClosed(session: Session): void {
  if (waiting === session.id && !session.gameState) {
    waiting = null;
    removeSession(session.id);
  }
}
