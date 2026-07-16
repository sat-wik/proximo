// Pure guess-selection logic for the bot. All randomness comes in through
// the injected rng (0 ≤ rng() < 1) so behavior is fully testable.

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
const MISS_RANK_CAP = 15000;
const PLATEAU_CHANCE = 0.28; // circle the current neighborhood without improving
const PLATEAU_FACTOR_MIN = 0.85;
const PLATEAU_FACTOR_MAX = 1.6;
const CONVERGE_FACTOR_MIN = 0.55;
const CONVERGE_FACTOR_MAX = 0.85;
const MAX_RANK = 19999;

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

/** Returns the rank the bot aims for this turn. 1 = go for the kill. */
export function chooseTargetRank(s: BotRoundState, rng: () => number): number {
  if (s.turnIndex >= s.killTurn + KILL_TURN_GRACE) return 1;

  const floor = Math.max(2, Math.round(FLOOR_BASE * FLOOR_DECAY ** s.turnIndex));

  // Endgame: close the distance decisively, but only guess the word itself
  // once genuinely near it — a kill from far away reads as superhuman
  if (s.turnIndex >= s.killTurn) {
    if (s.bestRank <= KILL_READY_RANK && rng() < KILL_CHANCE) return 1;
    const desired = Math.round(s.bestRank * uniform(rng, CLOSING_FACTOR_MIN, CLOSING_FACTOR_MAX));
    return Math.min(MAX_RANK, Math.max(2, Math.max(desired, floor)));
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
 * Nearest available word to the desired rank, walking outward (R, R+1, R-1,
 * R+2, …). Skips already-guessed words; skips rank 1 unless killing.
 */
export function pickWordAtRank(
  byRank: string[],
  guessed: Set<string>,
  desiredRank: number,
): string | null {
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
