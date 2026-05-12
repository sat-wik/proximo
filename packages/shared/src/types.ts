export type PlayerId = string;

// ── Live game types (used by both server and client) ──────────────────────

export interface GuessEntry {
  player: 'host' | 'guest';
  word: string;
  rank: number;
  bonuses: string[];
}

export interface GameState {
  phase: 'playing' | 'round-over' | 'match-over';
  round: number;
  currentTurn: 'host' | 'guest';
  guesses: GuessEntry[];
  scores: { host: number; guest: number };
  roundScores: Array<{ host: number; guest: number }>;
  roundWinner: 'host' | 'guest' | null;
  matchWinner: 'host' | 'guest' | null;
  revealedTarget?: string;
  hintRequest: 'host' | 'guest' | null;
  hints: string[];
}

export type GameMode = 'duel' | 'cooperative' | 'subversion';

export type BonusType = 'streak' | 'bracket' | 'steal' | 'kill';

export interface Bonus {
  type: BonusType;
  value: number;
}

export interface Guess {
  player: PlayerId;
  word: string;
  rank: number;
  rankForOther?: number; // subversion mode: rank against the other player's target
  timestamp: number;
  bonusesTriggered: Bonus[];
}

export interface PlayerScores {
  playerA: number;
  playerB: number;
}

export interface PlayerBonuses {
  playerA: Bonus[];
  playerB: Bonus[];
}

export interface Round {
  id: string;
  // Never sent to clients; host only
  targetWord: string;
  // Subversion mode: each player has a different target
  targetWordPlayerA?: string;
  targetWordPlayerB?: string;
  guesses: Guess[];
  scores: PlayerScores;
  bonusesEarned: PlayerBonuses;
  endedAt: number | null;
  winner: PlayerId | null;
}

export interface Match {
  id: string;
  rounds: Round[];
  winner: PlayerId | null;
}

export interface Player {
  id: PlayerId;
  name: string;
}

export interface Session {
  id: string;
  players: [Player, Player];
  mode: GameMode;
  currentMatch: Match;
  history: Match[];
}
