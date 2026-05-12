import type { GameState, GuessEntry } from '@closer/shared';
import {
  DICTIONARY_SIZE,
  ROUNDS_PER_MATCH,
  STREAK_BONUS_VALUE,
  STEAL_BONUS_VALUE,
} from '@closer/shared';
import { getRank } from '../services/embedding-service.js';
import { generateHint } from '../services/hint-service.js';


export function initialGameState(): GameState {
  return {
    phase: 'playing',
    round: 1,
    currentTurn: 'host',
    guesses: [],
    scores: { host: 0, guest: 0 },
    roundScores: [],
    roundWinner: null,
    matchWinner: null,
    hintRequest: null,
    hints: [],
  };
}

export function nextRoundState(current: GameState): GameState {
  return {
    phase: 'playing',
    round: current.round + 1,
    // loser of last round goes first
    currentTurn: current.roundWinner === 'host' ? 'guest' : 'host',
    guesses: [],
    scores: { host: 0, guest: 0 },
    roundScores: current.roundScores,
    roundWinner: null,
    matchWinner: null,
    hintRequest: null,
    hints: [],
  };
}

export async function applyHint(
  state: GameState,
  target: string,
): Promise<GameState> {
  const hint = await generateHint(target);
  return {
    ...state,
    hintRequest: null,
    hints: [...state.hints, hint],
  };
}

export async function applyGuess(
  state: GameState,
  word: string,
  player: 'host' | 'guest',
  target: string,
): Promise<{ state: GameState; error?: string }> {
  if (state.phase !== 'playing') {
    return { state, error: 'Round is not in progress.' };
  }
  if (state.currentTurn !== player) {
    return { state, error: 'Not your turn.' };
  }
  if (state.guesses.some((g) => g.word === word)) {
    return { state, error: 'Already guessed that word.' };
  }

  const rank = await getRank(target, word);
  if (rank === null) {
    return { state, error: 'Not in word list.' };
  }

  const bonuses: string[] = [];
  const newScores = { ...state.scores };
  newScores[player] += Math.round(DICTIONARY_SIZE / rank);

  // Steal: this guess is the new closest word overall
  const currentBestRank = state.guesses.reduce((min, g) => Math.min(min, g.rank), Infinity);
  const isSteal = state.guesses.length > 0 && rank < currentBestRank;
  if (isSteal) {
    newScores[player] += STEAL_BONUS_VALUE;
    bonuses.push(`+${STEAL_BONUS_VALUE} steal`);
  }

  // Streak: you just stole AND your previous guess was also a steal when you made it
  // (check the history at the time of that guess, not current state)
  const myPrevGuess = state.guesses.filter((g) => g.player === player).at(-1) ?? null;
  let prevWasSteal = false;
  if (myPrevGuess) {
    const myPrevIdx = state.guesses.findIndex((g) => g.word === myPrevGuess.word);
    const guessesBefore = state.guesses.slice(0, myPrevIdx);
    if (guessesBefore.length > 0) {
      const bestBeforeMyPrev = guessesBefore.reduce((min, g) => Math.min(min, g.rank), Infinity);
      prevWasSteal = myPrevGuess.rank < bestBeforeMyPrev;
    }
  }
  if (isSteal && prevWasSteal) {
    newScores[player] += STREAK_BONUS_VALUE;
    bonuses.push(`+${STREAK_BONUS_VALUE} streak`);
  }

  const newGuess: GuessEntry = { player, word, rank, bonuses };
  const isKill = rank === 1;

  let phase: GameState['phase'] = state.phase;
  let { roundWinner, matchWinner, roundScores, revealedTarget } = state;

  if (isKill) {
    roundWinner = player;
    revealedTarget = target;
    roundScores = [...state.roundScores, { ...newScores }];
    phase = 'round-over';

    if (state.round === ROUNDS_PER_MATCH) {
      const totHost  = roundScores.reduce((s, r) => s + r.host,  0);
      const totGuest = roundScores.reduce((s, r) => s + r.guest, 0);
      matchWinner = totHost >= totGuest ? 'host' : 'guest';
      phase = 'match-over';
    }
  }

  return {
    state: {
      ...state,
      phase,
      currentTurn: isKill ? state.currentTurn : (player === 'host' ? 'guest' : 'host'),
      guesses: [...state.guesses, newGuess],
      // scores resets to 0 after kill; roundScores holds the completed round
      scores: isKill ? { host: 0, guest: 0 } : newScores,
      roundScores,
      roundWinner,
      matchWinner,
      revealedTarget,
    },
  };
}
