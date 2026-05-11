import {
  STREAK_BONUS_VALUE,
  STEAL_BONUS_VALUE,
} from './constants';
import type { Guess, PlayerId } from './types';

export function applyBonus(currentScore: number, bonusValue: number): number {
  return currentScore + bonusValue;
}

export function checkStreakBonus(guesses: Guess[], player: PlayerId): boolean {
  const myGuesses = guesses.filter((g) => g.player === player);
  if (myGuesses.length < 2) return false;
  const last = myGuesses[myGuesses.length - 1];
  const prev = myGuesses[myGuesses.length - 2];
  const lastIdx = guesses.findIndex((g) => g.word === last.word);
  const prevIdx = guesses.findIndex((g) => g.word === prev.word);
  const beforeLast = guesses.slice(0, lastIdx);
  const beforePrev = guesses.slice(0, prevIdx);
  if (beforeLast.length === 0 || beforePrev.length === 0) return false;
  const bestBeforeLast = beforeLast.reduce((min, g) => Math.min(min, g.rank), Infinity);
  const bestBeforePrev = beforePrev.reduce((min, g) => Math.min(min, g.rank), Infinity);
  return last.rank < bestBeforeLast && prev.rank < bestBeforePrev;
}

export function checkStealBonus(guesses: Guess[], latestGuess: Guess): boolean {
  const before = guesses.slice(0, guesses.findIndex((g) => g.word === latestGuess.word));
  if (before.length === 0) return false;
  const bestBefore = before.reduce((min, g) => Math.min(min, g.rank), Infinity);
  return latestGuess.rank < bestBefore;
}

export function applyStreakBonus(score: number): number {
  return applyBonus(score, STREAK_BONUS_VALUE);
}

export function applyStealBonus(score: number): number {
  return applyBonus(score, STEAL_BONUS_VALUE);
}
