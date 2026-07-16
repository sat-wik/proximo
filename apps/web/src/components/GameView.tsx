import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameState, GuessEntry } from '@closer/shared';
import RulesModal from './RulesModal';

export type { GameState, GuessEntry };

interface Props {
  state: GameState;
  myRole: 'host' | 'guest';
  onSubmitGuess: (word: string) => void;
  onNextRound: () => void;
  onRequestHint: () => void;
  onAcceptHint: () => void;
  onRejectHint: () => void;
  onGiveUp: (scope: 'round' | 'game') => void;
  onAcceptGiveUp: () => void;
  onRejectGiveUp: () => void;
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
  return Math.max(1, Math.round(100 * Math.pow(2, -(rank - 1) / 499)));
}

function StreakFire({ count }: { count: number }) {
  const uid = useId().replace(/:/g, '');
  const ogId = `fgo-${uid}`;
  const igId = `fgi-${uid}`;
  return (
    <span className="streak-badge">
      <svg className="flame-svg" viewBox="0 0 24 32" width="16" height="22" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id={ogId} cx="50%" cy="85%" r="65%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="40%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.85" />
          </radialGradient>
          <radialGradient id={igId} cx="50%" cy="90%" r="55%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Outer flame */}
        <path
          className="flame-outer"
          d="M12 2 C9.5 6, 3 11, 3 18.5 C3 24.8, 7 30, 12 30 C17 30, 21 24.8, 21 18.5 C21 11, 14.5 6, 12 2Z"
          fill={`url(#${ogId})`}
        />
        {/* Inner bright core */}
        <path
          className="flame-inner"
          d="M12 10 C10.5 13, 7.5 16, 7.5 20 C7.5 23.5, 9.5 26, 12 26 C14.5 26, 16.5 23.5, 16.5 20 C16.5 16, 13.5 13, 12 10Z"
          fill={`url(#${igId})`}
        />
      </svg>
      <span className="streak-num">{count}</span>
    </span>
  );
}

function GuessRowContent({
  g,
  isMe,
  isOutlined,
  isActiveStreak,
}: {
  g: GuessEntry;
  isMe: boolean;
  isOutlined: boolean;
  isActiveStreak: boolean;
}) {
  const theme = rankTheme(g.rank);
  const width = barWidth(g.rank);

  return (
    <div
      className={`relative overflow-hidden w-full ${
        isOutlined
          ? 'ring-2 ring-inset ring-white/80'
          : 'border-b border-slate-800/60'
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${theme.bar} opacity-50`}
        style={{ width: `${width}%` }}
      />
      <div className="relative flex items-center gap-2 px-4 py-3">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isMe ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="flex-1 text-base font-semibold tracking-wide">{g.word}</span>
        {g.bonuses.map((b) => (
          <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/70 text-purple-300 border border-purple-700/50">
            {b}
          </span>
        ))}
        {isActiveStreak && g.streak !== undefined && (
          <StreakFire count={g.streak} />
        )}
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
  onRequestHint,
  onAcceptHint,
  onRejectHint,
  onGiveUp,
  onAcceptGiveUp,
  onRejectGiveUp,
  guessError,
  pendingGuess,
}: Props) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [revealingWord, setRevealingWord] = useState(false);
  const [giveUpModal, setGiveUpModal] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [notification, setNotification] = useState<'hint-accepted' | 'hint-rejected' | 'giveup-accepted' | 'giveup-rejected' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs to track previous values for detecting accept/reject transitions
  const prevHintReqRef   = useRef(state.hintRequest);
  const prevHintsLenRef  = useRef(state.hints.length);
  const prevGiveUpReqRef = useRef(state.giveUpRequest);

  const isMyTurn = state.currentTurn === myRole && state.phase === 'playing';
  const opponentName = state.vsBot ? 'CloserBot' : 'Friend';

  const totalScores = {
    host:  state.roundScores.reduce((s, r) => s + r.host,  0) + state.scores.host,
    guest: state.roundScores.reduce((s, r) => s + r.guest, 0) + state.scores.guest,
  };
  const myTotal    = myRole === 'host' ? totalScores.host  : totalScores.guest;
  const theirTotal = myRole === 'host' ? totalScores.guest : totalScores.host;
  const isLeading  = myTotal > theirTotal;

  const lastRound = state.roundScores[state.roundScores.length - 1] ?? { host: 0, guest: 0 };
  const myLastRound    = myRole === 'host' ? lastRound.host  : lastRound.guest;
  const theirLastRound = myRole === 'host' ? lastRound.guest : lastRound.host;

  const newestGuess = state.guesses.length > 0 ? state.guesses[state.guesses.length - 1] : null;
  const sortedGuesses = [...state.guesses].sort((a, b) => a.rank - b.rank);

  // Words that are part of an unbroken steal streak right now (per player)
  const activeStreakWords = new Set<string>();
  for (const role of ['host', 'guest'] as const) {
    const playerGuesses = state.guesses.filter((g) => g.player === role);
    const run: string[] = [];
    for (let i = playerGuesses.length - 1; i >= 0; i--) {
      if (playerGuesses[i].bonuses.some((b) => b.includes('steal'))) run.push(playerGuesses[i].word);
      else break;
    }
    if (run.length >= 2) run.forEach((w) => activeStreakWords.add(w));
  }

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

  useEffect(() => {
    if (state.phase !== 'match-over') return;
    setRevealingWord(true);
    const t = setTimeout(() => setRevealingWord(false), 5000);
    return () => clearTimeout(t);
  }, [state.phase]);

  // Detect hint accepted / rejected
  useEffect(() => {
    if (prevHintReqRef.current === myRole && state.hintRequest === null) {
      setNotification(state.hints.length > prevHintsLenRef.current ? 'hint-accepted' : 'hint-rejected');
    }
    prevHintReqRef.current = state.hintRequest;
    prevHintsLenRef.current = state.hints.length;
  }, [state.hintRequest, state.hints.length, myRole]);

  // Detect give-up accepted / rejected
  useEffect(() => {
    if (prevGiveUpReqRef.current?.player === myRole && state.giveUpRequest === null) {
      setNotification(state.phase === 'playing' ? 'giveup-rejected' : 'giveup-accepted');
    }
    prevGiveUpReqRef.current = state.giveUpRequest;
  }, [state.giveUpRequest, state.phase, myRole]);

  // Auto-clear notification
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 2400);
    return () => clearTimeout(t);
  }, [notification]);

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const word = input.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!word || pendingGuess) return;
    onSubmitGuess(word);
    setInput('');
  }

  function handleGiveUpSelect(scope: 'round' | 'game') {
    setGiveUpModal(false);
    onGiveUp(scope);
  }

  const myGiveUpRequest = state.giveUpRequest?.player === myRole ? state.giveUpRequest : null;
  const theirGiveUpRequest = state.giveUpRequest?.player !== myRole && state.giveUpRequest !== null
    ? state.giveUpRequest
    : null;

  return (
    <div className="flex flex-col bg-slate-950 text-white" style={{ height: '100dvh' }}>

      {/* ── Header ── */}
      <header className="flex-none border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScoreChip label="You" score={myTotal} highlight />
            <ScoreChip label={state.vsBot ? 'CloserBot' : 'Friend'} score={theirTotal} />
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Round</span>
            <span className="text-sm font-bold text-white leading-tight">
              {state.round} / 3
            </span>
          </div>

          <div className="w-24 flex items-center justify-end gap-2">
            <span className="text-xs text-slate-600">
              {state.guesses.length} guess{state.guesses.length !== 1 ? 'es' : ''}
            </span>
            <button
              onClick={() => setShowRules(true)}
              aria-label="How to play"
              className="w-7 h-7 flex-none rounded-full bg-slate-900 border border-slate-700 text-slate-500 active:bg-slate-800 text-sm font-bold transition-colors"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      {/* ── Input area (top, so keyboard doesn't cover it on mobile) ── */}
      {state.phase === 'playing' && (
        <div className="flex-none border-b border-slate-800 bg-slate-950 px-4 pt-3 pb-3">
          {guessError && (
            <p className="text-red-400 text-sm text-center mb-2">{guessError}</p>
          )}

          {state.hintRequest === null && state.giveUpRequest === null && (
            <div className="flex justify-between items-center mb-2">
              {state.guesses.length >= 50 ? (
                <button
                  onClick={onRequestHint}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 active:bg-slate-700 text-purple-300 border border-purple-800/50 transition-colors"
                >
                  💡 Request Hint
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => setGiveUpModal(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-950/60 active:bg-red-900/60 border border-red-800/50 text-red-400 transition-colors"
              >
                Give Up
              </button>
            </div>
          )}

          {state.hintRequest === myRole && (
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs text-purple-400">Hint requested — waiting for {opponentName}…</p>
            </div>
          )}

          {myGiveUpRequest && (
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs text-orange-400">
                Waiting for {opponentName} to accept give up ({myGiveUpRequest.scope})…
              </p>
            </div>
          )}

          {isMyTurn ? (
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
              <p className="text-slate-500 text-sm">{opponentName} is thinking…</p>
            </div>
          )}
        </div>
      )}

      {/* ── Guess list ── */}
      <main ref={listRef} className="flex-1 overflow-y-auto" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        {state.guesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <p className="text-4xl">🔍</p>
            <p className="text-slate-400 text-base">
              {isMyTurn ? 'You go first — type a word below.' : `Waiting for ${opponentName}…`}
            </p>
          </div>
        ) : (
          <div className="max-w-xl mx-auto">
            {/* ── Hints ── */}
            {state.hints.length > 0 && (
              <div className="px-4 pt-3 pb-2 flex flex-col gap-1.5 border-b border-slate-800">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Hints</span>
                {state.hints.map((h, i) => (
                  <p key={i} className="text-xs text-purple-300 italic">"{h}"</p>
                ))}
              </div>
            )}

            {/* ── Pinned: most recent guess ── */}
            {newestGuess && (
              <div className="border-b-2 border-slate-700">
                <GuessRowContent
                  g={newestGuess}
                  isMe={newestGuess.player === myRole}
                  isOutlined
                  isActiveStreak={activeStreakWords.has(newestGuess.word)}
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
                    isActiveStreak={activeStreakWords.has(g.word)}
                  />
                </li>
              ))}
            </ul>
          </div>
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
                {state.revealedTarget && state.roundEndReason === 'kill' && (
                  <p className="text-5xl font-bold tracking-tight text-yellow-300 mb-2">
                    {state.revealedTarget}
                  </p>
                )}
                {state.roundEndReason === 'kill' && (
                  <p className={`text-lg font-medium ${state.roundWinner === myRole ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {state.roundWinner === myRole ? 'You found it! 🎉' : `${opponentName} found it.`}
                  </p>
                )}
              </div>

              <div className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="flex divide-x divide-slate-800">
                  <div className="flex-1 text-center py-4">
                    <p className="text-xs text-slate-500 mb-1">You</p>
                    <p className="text-2xl font-bold">{myLastRound}</p>
                  </div>
                  <div className="flex-1 text-center py-4">
                    <p className="text-xs text-slate-500 mb-1">{opponentName}</p>
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
              {revealingWord && state.roundEndReason === 'kill' ? (
                <div className="text-center">
                  <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">The word was</p>
                  <p className="text-6xl font-bold tracking-tight text-yellow-300 mb-4">
                    {state.revealedTarget}
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-center">
                    <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Match over</p>
                    <p className="text-6xl mb-3">{state.matchWinner === myRole ? '🏆' : '🥈'}</p>
                    <p className="text-3xl font-bold">
                      {state.matchWinner === myRole ? 'You win!' : `${opponentName} wins!`}
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
            </>
          )}
        </div>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* ── Accept / Reject notification ── */}
      {notification && (
        <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center px-6">
          <div className="notif-card bg-slate-900/95 border border-slate-700 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            {notification.includes('rejected') ? (
              <span className="shake-icon text-5xl select-none">💔</span>
            ) : (
              <div className="pop-icon w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
                <span className="text-white text-3xl font-bold leading-none">✓</span>
              </div>
            )}
            <p className="text-white font-semibold text-sm text-center">
              {notification.includes('rejected') ? `${opponentName} rejected your request.` : `${opponentName} accepted!`}
            </p>
          </div>
        </div>
      )}

      {/* ── Hint request modal (received from other player) ── */}
      {state.hintRequest !== null && state.hintRequest !== myRole && (
        <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center px-6">
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-3 text-center">
              <p className="text-2xl mb-2">💡</p>
              <p className="text-white font-semibold text-base">Hint Request</p>
              <p className="text-slate-400 text-sm mt-1">
                Your friend wants a hint. Accepting will generate an AI clue visible to both players.
              </p>
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <button
                onClick={onAcceptHint}
                className="w-full py-3 rounded-xl bg-purple-700 active:bg-purple-800 text-white text-sm font-semibold transition-colors"
              >
                Accept
              </button>
              <button
                onClick={onRejectHint}
                className="w-full py-3 rounded-xl bg-slate-800 active:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Give-up request modal (received from other player) ── */}
      {theirGiveUpRequest && (
        <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center px-6">
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-3 text-center">
              <p className="text-2xl mb-2">🏳️</p>
              <p className="text-white font-semibold text-base">Friend Wants to Give Up</p>
              <p className="text-slate-400 text-sm mt-1">
                They want to give up the{' '}
                <span className="text-white font-medium">{theirGiveUpRequest.scope}</span>.
                {theirGiveUpRequest.scope === 'game'
                  ? ' This will end the match immediately.'
                  : ' This will end the current round.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <button
                onClick={onAcceptGiveUp}
                className="w-full py-3 rounded-xl bg-orange-700 active:bg-orange-800 text-white text-sm font-semibold transition-colors"
              >
                Accept
              </button>
              <button
                onClick={onRejectGiveUp}
                className="w-full py-3 rounded-xl bg-slate-800 active:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Give-up modal ── */}
      {giveUpModal && (
        <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center px-6">
          <div className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <p className="text-white font-semibold text-base text-center">Give Up</p>
              <p className="text-slate-400 text-sm text-center mt-1">
                {isLeading
                  ? `You're in the lead — ${opponentName} must agree.`
                  : 'What would you like to give up?'}
              </p>
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <button
                onClick={() => handleGiveUpSelect('round')}
                className="w-full py-3 rounded-xl bg-slate-800 active:bg-slate-700 text-white text-sm font-medium transition-colors"
              >
                This Round
              </button>
              <button
                onClick={() => handleGiveUpSelect('game')}
                className="w-full py-3 rounded-xl bg-red-900/60 active:bg-red-900 border border-red-800/60 text-red-300 text-sm font-medium transition-colors"
              >
                The Entire Game
              </button>
              <button
                onClick={() => setGiveUpModal(false)}
                className="w-full py-3 rounded-xl text-slate-500 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
