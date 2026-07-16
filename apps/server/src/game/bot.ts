import type { Session } from '../session-store.js';
import { getSession, touchSession } from '../session-store.js';
import { getRandomTarget } from '../services/target-service.js';
import { getWordsByRank } from '../services/embedding-service.js';
import { applyGuess, applyGiveUp, applyHint, initialGameState } from './engine.js';
import { chooseTargetRank, pickThinkDelayMs, pickWordAtRank, rollKillTurn, type BotRoundState } from './bot-strategy.js';

const GUESS_DELAY_MIN_MS = Number(process.env.BOT_DELAY_MIN_MS) || 2500;
const GUESS_DELAY_MAX_MS = Number(process.env.BOT_DELAY_MAX_MS) || 6000;
const ACCEPT_GIVE_UP_DELAY_MS = 1500;
const ACCEPT_HINT_DELAY_MS = 2000;

export interface BotState extends BotRoundState {
  round: number; // detects round transitions
  timer: NodeJS.Timeout | null; // at most one pending action
}

function sendToHost(session: Session): void {
  if (session.host?.readyState === 1 && session.gameState) {
    session.host.send(JSON.stringify({ type: 'game-state', state: session.gameState }));
  }
}

function commit(session: Session): void {
  touchSession(session.id);
  sendToHost(session);
  maybeBotAct(session);
}

function hostLive(session: Session): boolean {
  return session.host !== null && session.host.readyState === 1;
}

/** True while the session is still the one we scheduled against. */
function stillCurrent(session: Session): boolean {
  return getSession(session.id) === session && !!session.bot && !!session.gameState;
}

async function makeGuess(session: Session): Promise<void> {
  const bot = session.bot;
  const state = session.gameState;
  const target = session.targetWord;
  if (!bot || !state || !target) return;
  if (state.phase !== 'playing' || state.currentTurn !== 'guest') return;

  const byRank = await getWordsByRank(target);
  const guessed = new Set(state.guesses.map((g) => g.word));
  const boardBestRank = state.guesses.reduce((min, g) => Math.min(min, g.rank), Infinity);

  // The engine should never reject a word drawn from its own rank table,
  // but if it does, exclude it and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const desired = chooseTargetRank(bot, boardBestRank, Math.random);
    const word = pickWordAtRank(byRank, guessed, desired);
    if (!word) return;

    const { state: next, error } = await applyGuess(state, word, 'guest', target);
    if (error) {
      guessed.add(word);
      continue;
    }

    const actualRank = next.guesses[next.guesses.length - 1]!.rank;
    bot.bestRank = Math.min(bot.bestRank, actualRank);
    bot.turnIndex += 1;
    session.gameState = next;
    commit(session);
    return;
  }
  console.error(`bot: failed to produce a valid guess in session ${session.id}`);
}

function schedule(session: Session, delayMs: number, action: () => Promise<void>): void {
  const bot = session.bot!;
  bot.timer = setTimeout(() => {
    bot.timer = null;
    if (!stillCurrent(session) || !hostLive(session)) return; // paused; resumes on host rejoin
    void action();
  }, delayMs);
}

/**
 * Single dispatch point for the bot. Idempotent — call after every state
 * change and on host rejoin; it schedules at most one pending action.
 */
export function maybeBotAct(session: Session): void {
  const bot = session.bot;
  const state = session.gameState;
  if (!bot || !state || bot.timer) return;
  if (state.phase === 'match-over') return;

  if (state.round !== bot.round) {
    bot.round = state.round;
    bot.bestRank = Infinity;
    bot.turnIndex = 0;
    bot.killTurn = rollKillTurn(Math.random);
  }

  if (state.giveUpRequest?.player === 'host') {
    schedule(session, ACCEPT_GIVE_UP_DELAY_MS, async () => {
      const req = session.gameState?.giveUpRequest;
      if (!req || req.player !== 'host' || !session.targetWord) return;
      session.gameState = await applyGiveUp(session.gameState!, 'host', req.scope, session.targetWord);
      commit(session);
    });
    return;
  }

  if (state.hintRequest === 'host') {
    schedule(session, ACCEPT_HINT_DELAY_MS, async () => {
      if (session.gameState?.hintRequest !== 'host' || !session.targetWord) return;
      session.gameState = await applyHint(session.gameState, session.targetWord);
      commit(session);
    });
    return;
  }

  if (state.phase === 'playing' && state.currentTurn === 'guest') {
    const delay = pickThinkDelayMs(bot, GUESS_DELAY_MIN_MS, GUESS_DELAY_MAX_MS, Math.random);
    schedule(session, delay, () => makeGuess(session));
  }
}

/** Seat the bot as guest and start the game. Requires a live host. */
export async function attachBot(session: Session): Promise<void> {
  if (session.bot || session.gameState) return;

  session.targetWord = await getRandomTarget();
  await getWordsByRank(session.targetWord); // warm before the first guess
  session.bot = {
    bestRank: Infinity,
    turnIndex: 0,
    killTurn: rollKillTurn(Math.random),
    round: 1,
    timer: null,
  };
  session.gameState = { ...initialGameState(), vsBot: true };
  commit(session);
}
