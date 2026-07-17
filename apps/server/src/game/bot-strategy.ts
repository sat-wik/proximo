// Pure guess-selection logic for the bot. All randomness comes in through
// the injected rng (0 ≤ rng() < 1) so behavior is fully testable.
import { DICTIONARY_SIZE } from '@closer/shared';

// Tuning knobs — these set how human the bot feels and how long rounds run.
// Difficulty lives mostly in KILL_TURN_*: later kills give the human more
// turns to snipe the target off the bot's visible near-misses.
export const KILL_TURN_MIN = 11;
export const KILL_TURN_MAX = 17;
export const KILL_TURN_GRACE = 6; // forced finish this many turns past killTurn
const KILL_READY_RANK = 15; // natural kill only once the bot has gotten this close
const KILL_CHANCE = 0.5;
const CLOSING_FACTOR_MIN = 0.3; // endgame: decisive convergence toward the target
const CLOSING_FACTOR_MAX = 0.55;
const FLOOR_BASE = 3000; // per-turn floor blocks suspiciously early perfection
const FLOOR_DECAY = 0.6;
const OPENING_MIN = 2000;
const OPENING_MAX = 7000;
const MISS_CHANCE = 0.22; // exploratory miss: visibly regress instead of converging
const MISS_FACTOR_MIN = 1.8;
const MISS_FACTOR_MAX = 4.0;
const MISS_RANK_CAP = Math.round(DICTIONARY_SIZE * 0.75);
const PLATEAU_CHANCE = 0.28; // circle the current neighborhood without improving
const PLATEAU_FACTOR_MIN = 0.85;
const PLATEAU_FACTOR_MAX = 1.6;
const CONVERGE_FACTOR_MIN = 0.55;
const CONVERGE_FACTOR_MAX = 0.85;
const PIGGYBACK_CHANCE = 0.35; // riff off the human's best word when they lead
const PIGGYBACK_FACTOR_MIN = 0.7;
const PIGGYBACK_FACTOR_MAX = 1.3;
const PIGGYBACK_ANCHOR_MIN = 30; // never piggyback straight into sniping range
const MAX_RANK = DICTIONARY_SIZE - 1;

const THINK_OPENING_FACTOR = 0.6; // early guesses are low-effort
const THINK_ENDGAME_FACTOR = 1.35; // closing in takes focus
const LONG_THINK_CHANCE = 0.12; // occasionally stare at the ceiling
const LONG_THINK_FACTOR = 2.2;

export interface BotRoundState {
  bestRank: number; // Infinity at round start
  turnIndex: number; // bot guesses made this round, 0-based
  killTurn: number; // turn at which the bot starts trying to end the round
}

export function rollKillTurn(rng: () => number): number {
  return KILL_TURN_MIN + Math.floor(rng() * (KILL_TURN_MAX - KILL_TURN_MIN + 1));
}

function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Returns the rank the bot aims for this turn. 1 = go for the kill.
 * `boardBestRank` is the best rank on the board across BOTH players
 * (Infinity if no guesses yet) — when the human holds it, the bot
 * sometimes riffs off their word like a real opponent would.
 */
export function chooseTargetRank(s: BotRoundState, boardBestRank: number, rng: () => number): number {
  if (s.turnIndex >= s.killTurn + KILL_TURN_GRACE) return 1;

  const floor = Math.max(2, Math.round(FLOOR_BASE * FLOOR_DECAY ** s.turnIndex));

  // Endgame: close the distance decisively, but only guess the word itself
  // once genuinely near it — a kill from far away reads as superhuman
  if (s.turnIndex >= s.killTurn) {
    if (s.bestRank <= KILL_READY_RANK && rng() < KILL_CHANCE) return 1;
    const desired = Math.round(s.bestRank * uniform(rng, CLOSING_FACTOR_MIN, CLOSING_FACTOR_MAX));
    return Math.min(MAX_RANK, Math.max(2, Math.max(desired, floor)));
  }

  // Piggyback: the human found something closer than anything of ours —
  // guess near their rank. Skips the early-game floor deliberately: the
  // human led the way there, so it doesn't read as superhuman.
  if (boardBestRank < s.bestRank && s.turnIndex > 0 && rng() < PIGGYBACK_CHANCE) {
    const anchor = Math.max(boardBestRank, PIGGYBACK_ANCHOR_MIN);
    const desired = Math.round(anchor * uniform(rng, PIGGYBACK_FACTOR_MIN, PIGGYBACK_FACTOR_MAX));
    return Math.min(MAX_RANK, Math.max(2, desired));
  }

  let desired: number;
  if (s.turnIndex === 0) {
    desired = Math.round(uniform(rng, OPENING_MIN, OPENING_MAX));
  } else {
    const roll = rng();
    if (roll < MISS_CHANCE) {
      desired = Math.min(MISS_RANK_CAP, Math.round(s.bestRank * uniform(rng, MISS_FACTOR_MIN, MISS_FACTOR_MAX)));
    } else if (roll < MISS_CHANCE + PLATEAU_CHANCE) {
      desired = Math.round(s.bestRank * uniform(rng, PLATEAU_FACTOR_MIN, PLATEAU_FACTOR_MAX));
    } else {
      desired = Math.round(s.bestRank * uniform(rng, CONVERGE_FACTOR_MIN, CONVERGE_FACTOR_MAX));
    }
  }

  return Math.min(MAX_RANK, Math.max(2, Math.max(desired, floor)));
}

/**
 * Human-feeling thinking time: quick openings, slower endgame focus, and
 * the occasional long stare at the ceiling.
 */
export function pickThinkDelayMs(s: BotRoundState, minMs: number, maxMs: number, rng: () => number): number {
  let factor = 1;
  if (s.turnIndex <= 1) factor = THINK_OPENING_FACTOR;
  else if (s.turnIndex >= s.killTurn) factor = THINK_ENDGAME_FACTOR;
  if (rng() < LONG_THINK_CHANCE) factor *= LONG_THINK_FACTOR;
  return Math.round(uniform(rng, minMs, maxMs) * factor);
}

const RANK_WINDOW_FACTOR = 0.3; // search ±30% around the desired rank
const RANK_WINDOW_MIN = 8; // …but always at least this many ranks each way
const VOCAB_COMFORT_LIMIT = 12000; // commonness index a normal person knows
const PICK_POOL = 3; // choose among the N most common candidates

/**
 * Pick a word near the desired rank, preferring words a normal person
 * would actually say. A human aiming "somewhere around this close" doesn't
 * land on the exact rank — and never lands on "clinician" when "doctor"
 * is nearby. We search a window around the rank, keep candidates inside
 * everyday vocabulary (widening once if none qualify), and choose among
 * the few most common. Skips already-guessed words; rank 1 only when
 * killing. Without a commonness lookup, falls back to nearest-available.
 */
export function pickWordAtRank(
  byRank: string[],
  guessed: Set<string>,
  desiredRank: number,
  commonness?: (word: string) => number,
  rng: () => number = Math.random,
): string | null {
  if (desiredRank !== 1 && commonness) {
    for (const widen of [1, 2.5]) {
      const spread = Math.max(RANK_WINDOW_MIN, Math.round(desiredRank * RANK_WINDOW_FACTOR)) * widen;
      const lo = Math.max(2, Math.round(desiredRank - spread));
      const hi = Math.min(byRank.length, Math.round(desiredRank + spread));

      const candidates: string[] = [];
      for (let rank = lo; rank <= hi; rank++) {
        const word = byRank[rank - 1];
        if (word !== undefined && !guessed.has(word) && commonness(word) < VOCAB_COMFORT_LIMIT) {
          candidates.push(word);
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => commonness(a) - commonness(b));
        return candidates[Math.floor(rng() * Math.min(PICK_POOL, candidates.length))]!;
      }
    }
    // No everyday word anywhere near — fall through to nearest-available
  }

  const start = Math.min(byRank.length, Math.max(1, desiredRank)) - 1;
  const minIndex = desiredRank === 1 ? 0 : 1;

  for (let offset = 0; offset < byRank.length; offset++) {
    for (const i of [start + offset, start - offset]) {
      if (i < minIndex || i >= byRank.length) continue;
      const word = byRank[i];
      if (word !== undefined && !guessed.has(word)) return word;
      if (offset === 0) break; // start+0 === start-0
    }
  }
  return null;
}
