import { describe, expect, it } from 'vitest';
import {
  KILL_TURN_GRACE,
  KILL_TURN_MAX,
  KILL_TURN_MIN,
  chooseTargetRank,
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
        expect(chooseTargetRank(s, rng)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('always returns 1 by killTurn + grace, even when far from the target', () => {
    for (let seed = 0; seed < 500; seed++) {
      const s: BotRoundState = { bestRank: 9000, turnIndex: 12 + KILL_TURN_GRACE, killTurn: 12 };
      expect(chooseTargetRank(s, seededRng(seed))).toBe(1);
    }
  });

  it('respects the per-turn floor before killTurn', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = seededRng(seed);
      for (let turn = 1; turn < 8; turn++) {
        const floor = Math.max(2, Math.round(3000 * 0.6 ** turn));
        // bestRank of 2 pulls convergence far below the floor; floor must win
        const s: BotRoundState = { bestRank: 2, turnIndex: turn, killTurn: 12 };
        expect(chooseTargetRank(s, rng)).toBeGreaterThanOrEqual(floor);
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
        const rank = chooseTargetRank(s, rng);
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
});
