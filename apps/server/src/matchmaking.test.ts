import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@closer/shared';

vi.mock('./game/bot.js', () => ({
  attachBot: vi.fn(async () => {}),
  maybeBotAct: vi.fn(),
}));

const BOT_DELAY_MS = 1000;

// Modules read env at load time, so configure before importing them
let matchmaking: typeof import('./matchmaking.js');
let store: typeof import('./session-store.js');
let bot: typeof import('./game/bot.js');

beforeAll(async () => {
  vi.useFakeTimers();
  process.env.PERSIST_SESSIONS = '0';
  process.env.QUICK_MATCH_BOT_DELAY_MS = String(BOT_DELAY_MS);
  store = await import('./session-store.js');
  matchmaking = await import('./matchmaking.js');
  bot = await import('./game/bot.js');
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function liveSocket(): NonNullable<import('./session-store.js').Session['host']> {
  return { readyState: 1 } as never;
}

describe('quickMatch', () => {
  it('creates a waiting session, then pairs the next caller into it', () => {
    const first = matchmaking.quickMatch()!;
    expect(first.sessionId).toBeTruthy();
    expect(first.botDelayMs).toBe(BOT_DELAY_MS);

    const second = matchmaking.quickMatch()!;
    expect(second.sessionId).toBe(first.sessionId);

    // Slot was consumed — a third caller starts a fresh session
    const third = matchmaking.quickMatch()!;
    expect(third.sessionId).not.toBe(first.sessionId);
    store.removeSession(first.sessionId);
    store.removeSession(third.sessionId);
  });

  it('falls through to a new session when the waiting one is stale', () => {
    const first = matchmaking.quickMatch()!;
    store.removeSession(first.sessionId);

    const second = matchmaking.quickMatch()!;
    expect(second.sessionId).not.toBe(first.sessionId);
    store.removeSession(second.sessionId);
  });

  it('attaches a bot at timeout when the host is live', () => {
    const { sessionId } = matchmaking.quickMatch()!;
    const session = store.getSession(sessionId)!;
    session.host = liveSocket();

    vi.advanceTimersByTime(BOT_DELAY_MS);
    expect(bot.attachBot).toHaveBeenCalledWith(session);
    store.removeSession(sessionId);
  });

  it('removes the session at timeout when nobody ever connected', () => {
    const { sessionId } = matchmaking.quickMatch()!;

    vi.advanceTimersByTime(BOT_DELAY_MS);
    expect(bot.attachBot).not.toHaveBeenCalled();
    expect(store.getSession(sessionId)).toBeUndefined();

    // The slot was cleared too — next caller gets a fresh session
    const next = matchmaking.quickMatch()!;
    expect(next.sessionId).not.toBe(sessionId);
    store.removeSession(next.sessionId);
  });

  it('does nothing at timeout once a game has started', () => {
    const first = matchmaking.quickMatch()!;
    const session = store.getSession(first.sessionId)!;
    session.host = liveSocket();
    session.guest = liveSocket();
    session.gameState = { phase: 'playing' } as GameState;
    matchmaking.quickMatch(); // pair, consuming the slot

    vi.advanceTimersByTime(BOT_DELAY_MS);
    expect(bot.attachBot).not.toHaveBeenCalled();
    expect(store.getSession(first.sessionId)).toBe(session);
    store.removeSession(first.sessionId);
  });
});

describe('onSocketClosed', () => {
  it('frees the slot and removes the session when the waiter leaves', () => {
    const { sessionId } = matchmaking.quickMatch()!;
    const session = store.getSession(sessionId)!;

    matchmaking.onSocketClosed(session);
    expect(store.getSession(sessionId)).toBeUndefined();

    const next = matchmaking.quickMatch()!;
    expect(next.sessionId).not.toBe(sessionId);
    store.removeSession(next.sessionId);
  });

  it('ignores sessions that are not the waiting slot', () => {
    const first = matchmaking.quickMatch()!;
    const second = matchmaking.quickMatch()!; // pairs into first, slot now empty
    const session = store.getSession(second.sessionId)!;

    matchmaking.onSocketClosed(session);
    expect(store.getSession(second.sessionId)).toBe(session);
    store.removeSession(first.sessionId);
  });
});
