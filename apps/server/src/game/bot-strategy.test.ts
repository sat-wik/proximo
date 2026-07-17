import { describe, expect, it } from 'vitest';
import {
  KILL_TURN_GRACE,
  KILL_TURN_MAX,
  KILL_TURN_MIN,
  chooseTargetRank,
  pickThinkDelayMs,
  pickWordAtRank,
  rollKillTurn,
  type BotRoundState,
} from './bot-strategy.js';

// Deterministic rng (mulberry32) so every assertion is reproducible
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rollKillTurn', () => {
  it('stays within [KILL_TURN_MIN, KILL_TURN_MAX]', () => {
    for (let seed = 0; seed < 500; seed++) {
      const k = rollKillTurn(seededRng(seed));
      expect(k).toBeGreaterThanOrEqual(KILL_TURN_MIN);
      expect(k).toBeLessThanOrEqual(KILL_TURN_MAX);
    }
  });
});

describe('chooseTargetRank', () => {
  it('never returns rank 1 before killTurn', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = seededRng(seed);
      const killTurn = rollKillTurn(rng);
      for (let turn = 0; turn < killTurn; turn++) {
        const s: BotRoundState = { bestRank: 5, turnIndex: turn, killTurn };
        expect(chooseTargetRank(s, Infinity, rng)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('always returns 1 by killTurn + grace, even when far from the target', () => {
    for (let seed = 0; seed < 500; seed++) {
      const s: BotRoundState = { bestRank: 9000, turnIndex: 12 + KILL_TURN_GRACE, killTurn: 12 };
      expect(chooseTargetRank(s, Infinity, seededRng(seed))).toBe(1);
    }
  });

  it('respects the per-turn floor before killTurn', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = seededRng(seed);
      for (let turn = 1; turn < 8; turn++) {
        const floor = Math.max(2, Math.round(3000 * 0.6 ** turn));
        // bestRank of 2 pulls convergence far below the floor; floor must win
        const s: BotRoundState = { bestRank: 2, turnIndex: turn, killTurn: 12 };
        expect(chooseTargetRank(s, Infinity, rng)).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('simulated rounds end between killTurn and killTurn + grace', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rng = seededRng(seed);
      const killTurn = rollKillTurn(rng);
      const s: BotRoundState = { bestRank: Infinity, turnIndex: 0, killTurn };

      let killed = false;
      for (let turn = 0; turn < 40; turn++) {
        const rank = chooseTargetRank(s, Infinity, rng);
        if (rank === 1) {
          killed = true;
          break;
        }
        // Assume the guess lands exactly at the desired rank
        s.bestRank = Math.min(s.bestRank, rank);
        s.turnIndex += 1;
      }

      expect(killed).toBe(true);
      expect(s.turnIndex).toBeGreaterThanOrEqual(killTurn);
      expect(s.turnIndex).toBeLessThanOrEqual(killTurn + KILL_TURN_GRACE);
    }
  });

  it('piggybacks near the human-held board best, but never snipes rank 1', () => {
    const s: BotRoundState = { bestRank: 2000, turnIndex: 3, killTurn: 14 };
    let nearHuman = 0;
    for (let seed = 0; seed < 500; seed++) {
      const rank = chooseTargetRank(s, 100, seededRng(seed));
      expect(rank).toBeGreaterThanOrEqual(2);
      if (rank >= 70 && rank <= 130) nearHuman++; // 0.7–1.3 × human's rank 100
    }
    // ~35% of turns should riff off the human's word
    expect(nearHuman).toBeGreaterThan(100);

    // Without a human-held board best, the early-game floor forbids that zone
    for (let seed = 0; seed < 500; seed++) {
      expect(chooseTargetRank(s, Infinity, seededRng(seed))).toBeGreaterThanOrEqual(648);
    }
  });
});

describe('pickWordAtRank', () => {
  const byRank = ['target', 'alpha', 'beta', 'gamma', 'delta'];

  it('returns the word at the desired rank when available', () => {
    expect(pickWordAtRank(byRank, new Set(), 3)).toBe('beta');
  });

  it('walks outward past guessed words, preferring the higher rank', () => {
    expect(pickWordAtRank(byRank, new Set(['beta']), 3)).toBe('gamma');
    expect(pickWordAtRank(byRank, new Set(['beta', 'gamma']), 3)).toBe('alpha');
  });

  it('never returns rank 1 unless killing', () => {
    expect(pickWordAtRank(byRank, new Set(['alpha', 'beta', 'gamma', 'delta']), 2)).toBeNull();
    expect(pickWordAtRank(byRank, new Set(), 1)).toBe('target');
  });

  it('clamps desired ranks beyond the table to the last word', () => {
    expect(pickWordAtRank(byRank, new Set(), 500)).toBe('delta');
  });

  describe('with a commonness lookup (human vocabulary)', () => {
    // 30-word table; word at rank r is "w<r>"
    const table = Array.from({ length: 30 }, (_, i) => `w${i + 1}`);

    it('prefers the most common word in the window over the exact rank', () => {
      // w10 sits exactly at the desired rank but is obscure; w13 is everyday
      const commonness = (w: string) => (w === 'w13' ? 50 : w === 'w10' ? 20000 : 11000);
      const pick = pickWordAtRank(table, new Set(), 10, commonness, () => 0);
      expect(pick).toBe('w13');
    });

    it('widens the window when nothing nearby is everyday vocabulary', () => {
      // Only w25 is common; it is outside the first ±8 window around rank 10
      const commonness = (w: string) => (w === 'w25' ? 100 : 20000);
      const pick = pickWordAtRank(table, new Set(), 10, commonness, () => 0);
      expect(pick).toBe('w25');
    });

    it('falls back to nearest-available when no common word exists at all', () => {
      const commonness = () => 20000;
      const pick = pickWordAtRank(table, new Set(), 10, commonness, () => 0);
      expect(pick).toBe('w10');
    });

    it('never picks rank 1 and never repeats guesses', () => {
      const commonness = () => 5;
      for (let seed = 0; seed < 50; seed++) {
        const pick = pickWordAtRank(table, new Set(['w2', 'w3']), 2, commonness, seededRng(seed));
        expect(pick).not.toBe('w1');
        expect(['w2', 'w3']).not.toContain(pick);
      }
    });
  });
});

describe('pickThinkDelayMs', () => {
  it('stays within sane bounds and thinks harder in the endgame', () => {
    const MIN = 2500;
    const MAX = 6000;
    let openingTotal = 0;
    let endgameTotal = 0;
    for (let seed = 0; seed < 500; seed++) {
      const opening = pickThinkDelayMs({ bestRank: Infinity, turnIndex: 0, killTurn: 14 }, MIN, MAX, seededRng(seed));
      const endgame = pickThinkDelayMs({ bestRank: 40, turnIndex: 15, killTurn: 14 }, MIN, MAX, seededRng(seed + 1000));
      expect(opening).toBeGreaterThanOrEqual(MIN * 0.6 * 0.99);
      expect(endgame).toBeLessThanOrEqual(MAX * 1.35 * 2.2 * 1.01); // long-think ceiling
      openingTotal += opening;
      endgameTotal += endgame;
    }
    expect(openingTotal).toBeLessThan(endgameTotal);
  });
});
