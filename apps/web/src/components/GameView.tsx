import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DICTIONARY_SIZE } from '@closer/shared';
import type { GameState, GuessEntry } from '@closer/shared';

export type { GameState, GuessEntry };

interface Props {
  state: GameState;
  myRole: 'host' | 'guest';
  onSubmitGuess: (word: string) => void;
  onNextRound: () => void;
  guessError: string | null;
  pendingGuess: boolean;
}

function rankTheme(rank: number) {
  if (rank === 1)    return { badge: 'bg-yellow-400 text-black', bar: 'bg-yellow-400' };
  if (rank <= 100)   return { badge: 'bg-emerald-500 text-black', bar: 'bg-emerald-500' };
  if (rank <= 500)   return { badge: 'bg-teal-400 text-black',    bar: 'bg-teal-400' };
  if (rank <= 1500)  return { badge: 'bg-yellow-500 text-black',  bar: 'bg-yellow-500' };
  if (rank <= 5000)  return { badge: 'bg-orange-500 text-black',  bar: 'bg-orange-500' };
  return              { badge: 'bg-slate-600 text-white',          bar: 'bg-slate-600' };
}

function barWidth(rank: number): number {
  // rank 1 → 100%, rank 500 → 50%, rank 1000 → 25%
  return Math.max(1, Math.round(100 * Math.pow(2, -(rank - 1) / 499)));
}

// Shared row content — used for both the pinned row and the sorted list
function GuessRowContent({
  g,
  isMe,
  isOutlined,
}: {
  g: GuessEntry;
  isMe: boolean;
  isOutlined: boolean;
}) {
  const theme = rankTheme(g.rank);
  const width = barWidth(g.rank);
  return (
    <div
      className={`relative overflow-hidden w-full md:w-1/2 md:mx-auto ${
        isOutlined
          ? 'ring-2 ring-inset ring-white/80'
          : 'border-b border-slate-800/60'
      }`}
    >
      {/* Full-height background bar */}
      <div
        className={`absolute inset-y-0 left-0 ${theme.bar} opacity-50`}
        style={{ width: `${width}%` }}
      />
      {/* Row content */}
      <div className="relative flex items-center gap-2 px-4 py-3">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isMe ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="flex-1 text-base font-semibold tracking-wide">{g.word}</span>
        {g.bonuses.map((b) => (
          <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/70 text-purple-300 border border-purple-700/50">
            {b}
          </span>
        ))}
        <span className={`text-xs font-bold px-2 py-1 rounded-md min-w-[3.5rem] text-center tabular-nums ${theme.badge}`}>
          {g.rank === 1 ? '★ 1' : `# ${g.rank.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}

export default function GameView({
  state,
  myRole,
  onSubmitGuess,
  onNextRound,
  guessError,
  pendingGuess,
}: Props) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isMyTurn = state.currentTurn === myRole && state.phase === 'playing';

  const totalScores = {
    host:  state.roundScores.reduce((s, r) => s + r.host,  0) + state.scores.host,
    guest: state.roundScores.reduce((s, r) => s + r.guest, 0) + state.scores.guest,
  };
  const myTotal    = myRole === 'host' ? totalScores.host  : totalScores.guest;
  const theirTotal = myRole === 'host' ? totalScores.guest : totalScores.host;

  const lastRound = state.roundScores[state.roundScores.length - 1] ?? { host: 0, guest: 0 };
  const myLastRound    = myRole === 'host' ? lastRound.host  : lastRound.guest;
  const theirLastRound = myRole === 'host' ? lastRound.guest : lastRound.host;

  const newestGuess = state.guesses.length > 0 ? state.guesses[state.guesses.length - 1] : null;

  // Pure rank sort — newest appears pinned above, then again here in rank order
  const sortedGuesses = [...state.guesses].sort((a, b) => a.rank - b.rank);

  // FLIP animation for the sorted list only (pinned row never moves)
  const itemRefs    = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const currentRects = new Map<string, DOMRect>();
    itemRefs.current.forEach((el, word) => {
      if (el) currentRects.set(word, el.getBoundingClientRect());
    });

    itemRefs.current.forEach((el, word) => {
      if (!el) return;
      const prev = prevRectsRef.current.get(word);
      if (!prev) return;
      const curr = currentRects.get(word);
      if (!curr) return;
      const dy = prev.top - curr.top;
      if (Math.abs(dy) < 1) return;

      el.style.transform = `translateY(${dy}px)`;
      el.style.transition = 'none';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transform = '';
        el.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      }));
    });

    prevRectsRef.current = currentRects;
  }, [state.guesses]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [state.guesses.length]);

  useEffect(() => {
    if (isMyTurn) inputRef.current?.focus();
  }, [isMyTurn]);

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const word = input.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!word || pendingGuess) return;
    onSubmitGuess(word);
    setInput('');
  }

  return (
    <div className="flex flex-col bg-slate-950 text-white" style={{ height: '100dvh' }}>

      {/* ── Header ── */}
      <header className="flex-none border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScoreChip label="You" score={myTotal} highlight />
            <ScoreChip label="Friend" score={theirTotal} />
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Round</span>
            <span className="text-sm font-bold text-white leading-tight">
              {state.round} / 3
            </span>
          </div>

          <div className="w-24 text-right">
            <span className="text-xs text-slate-600">
              {state.guesses.length} guess{state.guesses.length !== 1 ? 'es' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* ── Guess list ── */}
      <main ref={listRef} className="flex-1 overflow-y-auto">
        {state.guesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <p className="text-4xl">🔍</p>
            <p className="text-slate-400 text-base">
              {isMyTurn ? 'You go first — type a word below.' : 'Waiting for friend…'}
            </p>
          </div>
        ) : (
          <>
            {/* ── Pinned: most recent guess ── */}
            {newestGuess && (
              <div className="border-b-2 border-slate-700">
                <GuessRowContent
                  g={newestGuess}
                  isMe={newestGuess.player === myRole}
                  isOutlined
                />
              </div>
            )}

            {/* ── Sorted list (closest first) ── */}
            <ul className="pt-6">
              {sortedGuesses.map((g) => (
                <li
                  key={g.word}
                  ref={(el) => {
                    if (el) itemRefs.current.set(g.word, el);
                    else itemRefs.current.delete(g.word);
                  }}
                  className="guess-item"
                >
                  <GuessRowContent
                    g={g}
                    isMe={g.player === myRole}
                    isOutlined={g.word === newestGuess?.word}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {/* ── Round-over / match-over overlay ── */}
      {state.phase !== 'playing' && (
        <div className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center gap-6 px-6">
          {state.phase === 'round-over' && (
            <>
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">
                  Round {state.round} complete
                </p>
                {state.revealedTarget && (
                  <p className="text-5xl font-bold tracking-tight text-yellow-300 mb-2">
                    {state.revealedTarget}
                  </p>
                )}
                <p className={`text-lg font-medium ${state.roundWinner === myRole ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {state.roundWinner === myRole ? 'You found it! 🎉' : 'Friend found it.'}
                </p>
              </div>

              <div className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="flex divide-x divide-slate-800">
                  <div className="flex-1 text-center py-4">
                    <p className="text-xs text-slate-500 mb-1">You</p>
                    <p className="text-2xl font-bold">{myLastRound}</p>
                  </div>
                  <div className="flex-1 text-center py-4">
                    <p className="text-xs text-slate-500 mb-1">Friend</p>
                    <p className="text-2xl font-bold text-slate-300">{theirLastRound}</p>
                  </div>
                </div>
                <div className="border-t border-slate-800 flex divide-x divide-slate-800 bg-slate-900/50">
                  <div className="flex-1 text-center py-2">
                    <p className="text-[10px] text-slate-600 mb-0.5">Total</p>
                    <p className="text-sm font-semibold">{myTotal}</p>
                  </div>
                  <div className="flex-1 text-center py-2">
                    <p className="text-[10px] text-slate-600 mb-0.5">Total</p>
                    <p className="text-sm font-semibold text-slate-400">{theirTotal}</p>
                  </div>
                </div>
              </div>

              {myRole === 'host' ? (
                <button
                  onClick={onNextRound}
                  className="w-full max-w-xs bg-emerald-600 active:bg-emerald-700 text-white font-semibold text-base py-4 rounded-2xl transition-colors"
                >
                  Next Round →
                </button>
              ) : (
                <p className="text-slate-500 text-sm">Waiting for host…</p>
              )}
            </>
          )}

          {state.phase === 'match-over' && (
            <>
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Match over</p>
                <p className="text-6xl mb-3">{state.matchWinner === myRole ? '🏆' : '🥈'}</p>
                <p className="text-3xl font-bold">
                  {state.matchWinner === myRole ? 'You win!' : 'Friend wins!'}
                </p>
                <p className="text-slate-400 mt-2 text-sm">
                  {myTotal} vs {theirTotal} — higher score wins
                </p>
              </div>
              <button
                onClick={() => navigate('/')}
                className="w-full max-w-xs bg-slate-800 active:bg-slate-700 text-white font-semibold text-base py-4 rounded-2xl transition-colors"
              >
                Back to Home
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Input footer ── */}
      <footer
        className="flex-none border-t border-slate-800 bg-slate-950 px-4 pt-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        {guessError && (
          <p className="text-red-400 text-sm text-center mb-2">{guessError}</p>
        )}

        {state.phase === 'playing' && (
          isMyTurn ? (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a word…"
                disabled={pendingGuess}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || pendingGuess}
                className="bg-emerald-600 active:bg-emerald-700 disabled:opacity-40 text-white font-bold text-base px-5 py-3 rounded-xl transition-colors min-w-[56px]"
              >
                {pendingGuess ? '…' : 'Go'}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-2 py-3">
              <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
              <p className="text-slate-500 text-sm">Friend is thinking…</p>
            </div>
          )
        )}
      </footer>
    </div>
  );
}

function ScoreChip({ label, score, highlight }: { label: string; score: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-[10px] uppercase tracking-widest mb-0.5 ${highlight ? 'text-emerald-500' : 'text-slate-500'}`}>
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${highlight ? 'text-white' : 'text-slate-400'}`}>
        {score.toLocaleString()}
      </p>
    </div>
  );
}
