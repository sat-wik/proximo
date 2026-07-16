import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Session } from '../session-store.js';
import { getSession, touchSession } from '../session-store.js';
import { getRandomTarget } from '../services/target-service.js';
import { applyGuess, applyGiveUp, applyHint, initialGameState, nextRoundState } from '../game/engine.js';
import { maybeBotAct } from '../game/bot.js';
import { onSocketClosed } from '../matchmaking.js';

const MAX_HINTS_PER_ROUND = 3;
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX_MESSAGES = 40;

const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), sessionId: z.string() }),
  z.object({ type: z.literal('submit-guess'), word: z.string().min(1).max(60) }),
  z.object({ type: z.literal('next-round') }),
  z.object({ type: z.literal('request-hint') }),
  z.object({ type: z.literal('accept-hint') }),
  z.object({ type: z.literal('reject-hint') }),
  z.object({ type: z.literal('give-up'), scope: z.enum(['round', 'game']) }),
  z.object({ type: z.literal('accept-give-up') }),
  z.object({ type: z.literal('reject-give-up') }),
]);

function send(socket: WebSocket, msg: object): void {
  if (socket.readyState === 1 /* OPEN */) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcast(session: { host: WebSocket | null; guest: WebSocket | null }, msg: object): void {
  if (session.host) send(session.host, msg);
  if (session.guest) send(session.guest, msg);
}

function commit(session: Session): void {
  touchSession(session.id);
  broadcast(session, { type: 'game-state', state: session.gameState });
  maybeBotAct(session);
}

export function handleSignaling(socket: WebSocket): void {
  let sessionId: string | null = null;
  let role: 'host' | 'guest' | null = null;
  let windowStart = Date.now();
  let windowCount = 0;

  socket.on('message', async (raw: Buffer) => {
    const now = Date.now();
    if (now - windowStart > WS_RATE_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > WS_RATE_MAX_MESSAGES) {
      socket.close();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const result = ClientMessage.safeParse(parsed);
    if (!result.success) {
      send(socket, { type: 'error', message: 'Invalid message' });
      return;
    }

    const msg = result.data;

    // ── join ──────────────────────────────────────────────────────────────
    if (msg.type === 'join') {
      const session = getSession(msg.sessionId);
      if (!session) {
        send(socket, { type: 'error', message: 'Session not found' });
        return;
      }

      const hostLive  = session.host  !== null && session.host.readyState  === 1;
      const guestLive = session.guest !== null && session.guest.readyState === 1;

      // The bot holds the guest seat; only the (rejoining) human may enter
      if ((hostLive && guestLive) || (session.bot && hostLive)) {
        send(socket, { type: 'error', message: 'Session full' });
        return;
      }

      sessionId = msg.sessionId;

      if (!hostLive) {
        session.host = socket;
        role = 'host';
        send(socket, { type: 'joined', role: 'host' });
      } else {
        session.guest = socket;
        role = 'guest';
        send(socket, { type: 'joined', role: 'guest' });
      }

      // If game already exists (reconnect), send current state to the rejoining player
      if (session.gameState) {
        send(socket, { type: 'game-state', state: session.gameState });
        maybeBotAct(session); // resume a bot paused by the host's disconnect
        return;
      }

      // Both players now connected for the first time — start the game
      if (session.host?.readyState === 1 && session.guest?.readyState === 1) {
        session.targetWord = await getRandomTarget();
        session.gameState = initialGameState();
        commit(session);
      }
      return;
    }

    // ── submit-guess ──────────────────────────────────────────────────────
    if (msg.type === 'submit-guess') {
      if (!sessionId || !role) {
        send(socket, { type: 'error', message: 'Not in a session' });
        return;
      }
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;

      const { state, error } = await applyGuess(
        session.gameState,
        msg.word.toLowerCase().trim(),
        role,
        session.targetWord,
      );

      if (error) {
        send(socket, { type: 'guess-rejected', reason: error });
        return;
      }

      session.gameState = state;
      commit(session);
      return;
    }

    // ── next-round ────────────────────────────────────────────────────────
    if (msg.type === 'next-round') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || session.gameState.phase !== 'round-over') return;

      session.targetWord = await getRandomTarget(session.targetWord ? [session.targetWord] : []);
      session.gameState = nextRoundState(session.gameState);
      commit(session);
    }

    // ── request-hint ──────────────────────────────────────────────────────
    if (msg.type === 'request-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || session.gameState.phase !== 'playing') return;
      // Only one pending request at a time; can't request if you already did
      if (session.gameState.hintRequest !== null) return;
      if (session.gameState.hints.length >= MAX_HINTS_PER_ROUND) return;

      session.gameState = { ...session.gameState, hintRequest: role };
      commit(session);
    }

    // ── accept-hint ───────────────────────────────────────────────────────
    if (msg.type === 'accept-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;
      if (session.gameState.hintRequest === null || session.gameState.hintRequest === role) return;

      session.gameState = await applyHint(session.gameState, session.targetWord);
      commit(session);
    }

    // ── reject-hint ───────────────────────────────────────────────────────
    if (msg.type === 'reject-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState) return;
      if (session.gameState.hintRequest === null || session.gameState.hintRequest === role) return;

      session.gameState = { ...session.gameState, hintRequest: null };
      commit(session);
    }

    // ── give-up ───────────────────────────────────────────────────────────
    if (msg.type === 'give-up') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;
      if (session.gameState.phase !== 'playing') return;

      const gs = session.gameState;
      const totHost  = gs.roundScores.reduce((s, r) => s + r.host,  0) + gs.scores.host;
      const totGuest = gs.roundScores.reduce((s, r) => s + r.guest, 0) + gs.scores.guest;
      const myTotal    = role === 'host' ? totHost : totGuest;
      const theirTotal = role === 'host' ? totGuest : totHost;
      const isLeading  = myTotal > theirTotal;

      if (isLeading) {
        // Needs other player's consent
        session.gameState = { ...gs, giveUpRequest: { player: role, scope: msg.scope } };
      } else {
        // Not leading — give up directly
        session.gameState = applyGiveUp(gs, role, msg.scope, session.targetWord);
      }
      commit(session);
    }

    // ── accept-give-up ────────────────────────────────────────────────────
    if (msg.type === 'accept-give-up') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;
      const req = session.gameState.giveUpRequest;
      if (!req || req.player === role) return; // only other player can accept

      session.gameState = applyGiveUp(session.gameState, req.player, req.scope, session.targetWord);
      commit(session);
    }

    // ── reject-give-up ────────────────────────────────────────────────────
    if (msg.type === 'reject-give-up') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState) return;
      const req = session.gameState.giveUpRequest;
      if (!req || req.player === role) return;

      session.gameState = { ...session.gameState, giveUpRequest: null };
      commit(session);
    }
  });

  socket.on('close', () => {
    if (!sessionId || !role) return;
    const session = getSession(sessionId);
    if (!session) return;
    if (role === 'host') session.host = null;
    else session.guest = null;
    onSocketClosed(session);
  });
}
