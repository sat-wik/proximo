import type { WebSocket } from 'ws';
import { z } from 'zod';
import { getSession, touchSession } from '../session-store.js';
import { getRandomTarget } from '../services/target-service.js';
import { applyGuess, applyGiveUp, applyHint, initialGameState, nextRoundState } from '../game/engine.js';

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

export function handleSignaling(socket: WebSocket): void {
  let sessionId: string | null = null;
  let role: 'host' | 'guest' | null = null;

  socket.on('message', async (raw: Buffer) => {
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

      if (hostLive && guestLive) {
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
        return;
      }

      // Both players now connected for the first time — start the game
      if (session.host?.readyState === 1 && session.guest?.readyState === 1) {
        session.targetWord = await getRandomTarget();
        session.gameState = initialGameState();
        touchSession(sessionId);
        broadcast(session, { type: 'game-state', state: session.gameState });
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
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state });
      return;
    }

    // ── next-round ────────────────────────────────────────────────────────
    if (msg.type === 'next-round') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || session.gameState.phase !== 'round-over') return;

      session.targetWord = await getRandomTarget(session.targetWord ? [session.targetWord] : []);
      session.gameState = nextRoundState(session.gameState);
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }

    // ── request-hint ──────────────────────────────────────────────────────
    if (msg.type === 'request-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || session.gameState.phase !== 'playing') return;
      // Only one pending request at a time; can't request if you already did
      if (session.gameState.hintRequest !== null) return;

      session.gameState = { ...session.gameState, hintRequest: role };
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }

    // ── accept-hint ───────────────────────────────────────────────────────
    if (msg.type === 'accept-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;
      if (session.gameState.hintRequest === null || session.gameState.hintRequest === role) return;

      session.gameState = await applyHint(session.gameState, session.targetWord);
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }

    // ── reject-hint ───────────────────────────────────────────────────────
    if (msg.type === 'reject-hint') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState) return;
      if (session.gameState.hintRequest === null || session.gameState.hintRequest === role) return;

      session.gameState = { ...session.gameState, hintRequest: null };
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
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
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }

    // ── accept-give-up ────────────────────────────────────────────────────
    if (msg.type === 'accept-give-up') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState || !session.targetWord) return;
      const req = session.gameState.giveUpRequest;
      if (!req || req.player === role) return; // only other player can accept

      session.gameState = applyGiveUp(session.gameState, req.player, req.scope, session.targetWord);
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }

    // ── reject-give-up ────────────────────────────────────────────────────
    if (msg.type === 'reject-give-up') {
      if (!sessionId || !role) return;
      const session = getSession(sessionId);
      if (!session?.gameState) return;
      const req = session.gameState.giveUpRequest;
      if (!req || req.player === role) return;

      session.gameState = { ...session.gameState, giveUpRequest: null };
      touchSession(sessionId);
      broadcast(session, { type: 'game-state', state: session.gameState });
    }
  });

  socket.on('close', () => {
    if (!sessionId || !role) return;
    const session = getSession(sessionId);
    if (!session) return;
    if (role === 'host') session.host = null;
    else session.guest = null;
  });
}
