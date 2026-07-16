import type { GameState, GuessEntry } from '@closer/shared';
import {
  DICTIONARY_SIZE,
  ROUNDS_PER_MATCH,
  STEAL_BONUS_VALUE,
} from '@closer/shared';
import { getRank, getWordsByRank } from '../services/embedding-service.js';
import { generateHint } from '../services/hint-service.js';

/** The 10 words closest to the target (ranks 2–11), for the round-end reveal. */
async function fetchNearMisses(target: string): Promise<string[]> {
  try {
    return (await getWordsByRank(target)).slice(1, 11);
  } catch {
    return []; // a rank-table hiccup must never break round end
  }
}


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
    giveUpRequest: null,
    roundEndReason: null,
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
    giveUpRequest: null,
    roundEndReason: null,
    vsBot: current.vsBot,
    roundGuesses: current.roundGuesses,
  };
}

export async function applyGiveUp(
  state: GameState,
  givingUp: 'host' | 'guest',
  scope: 'round' | 'game',
  target: string,
): Promise<GameState> {
  const roundWinner: 'host' | 'guest' = givingUp === 'host' ? 'guest' : 'host';
  const roundScores = [...state.roundScores, { ...state.scores }];
  const totHost  = roundScores.reduce((s, r) => s + r.host,  0);
  const totGuest = roundScores.reduce((s, r) => s + r.guest, 0);
  const matchWinner: 'host' | 'guest' = totHost >= totGuest ? 'host' : 'guest';
  const nearMisses = await fetchNearMisses(target);
  const roundGuesses = [...(state.roundGuesses ?? []), state.guesses];

  if (scope === 'game' || state.round === ROUNDS_PER_MATCH) {
    return {
      ...state,
      scores: { host: 0, guest: 0 },
      phase: 'match-over',
      roundScores,
      roundWinner,
      matchWinner,
      revealedTarget: target,
      giveUpRequest: null,
      roundEndReason: 'give-up',
      nearMisses,
      roundGuesses,
    };
  }

  return {
    ...state,
    scores: { host: 0, guest: 0 },
    phase: 'round-over',
    roundScores,
    roundWinner,
    revealedTarget: target,
    giveUpRequest: null,
    roundEndReason: 'give-up',
    nearMisses,
    roundGuesses,
  };
}

export async function applyHint(
  state: GameState,
  target: string,
): Promise<GameState> {
  const hint = await generateHint(target, state.hints);
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

  // Count consecutive steals by this player (current guess counts as 1)
  let streakLen: number | undefined;
  if (isSteal) {
    const myPrevGuesses = state.guesses.filter((g) => g.player === player);
    let streak = 1;
    for (let i = myPrevGuesses.length - 1; i >= 0; i--) {
      if (myPrevGuesses[i].bonuses.some((b) => b.includes('steal'))) streak++;
      else break;
    }
    const stealBonus = STEAL_BONUS_VALUE * streak;
    newScores[player] += stealBonus;
    bonuses.push(`+${stealBonus} steal`);
    if (streak >= 2) streakLen = streak;
  }

  const newGuess: GuessEntry = { player, word, rank, bonuses, ...(streakLen !== undefined && { streak: streakLen }) };
  const isKill = rank === 1;

  let phase: GameState['phase'] = state.phase;
  let { roundWinner, matchWinner, roundScores, revealedTarget, nearMisses, roundGuesses } = state;
  let roundEndReason: GameState['roundEndReason'] = state.roundEndReason;

  if (isKill) {
    roundWinner = player;
    revealedTarget = target;
    roundScores = [...state.roundScores, { ...newScores }];
    roundEndReason = 'kill';
    phase = 'round-over';
    nearMisses = await fetchNearMisses(target);
    roundGuesses = [...(state.roundGuesses ?? []), [...state.guesses, newGuess]];

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
      roundEndReason,
      nearMisses,
      roundGuesses,
    },
  };
}
