import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import GameView from '../components/GameView';
import type { GameState } from '@closer/shared';

type LobbyState = 'connecting' | 'waiting' | 'ready' | 'error';

type ServerMsg =
  | { type: 'joined'; role: 'host' | 'guest' }
  | { type: 'game-state'; state: GameState }
  | { type: 'guess-rejected'; reason: string }
  | { type: 'error'; message: string };

export default function LobbyPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ?quick=<botDelayMs> marks a quick-match session: show the searching UI
  // instead of the share link while waiting for an opponent
  const quickParam = searchParams.get('quick');
  const isQuickMatch = quickParam !== null;
  const botDelayMs = Number(quickParam) || 20_000;

  const [lobbyState, setLobbyState] = useState<LobbyState>('connecting');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [matchReveal, setMatchReveal] = useState<'bot' | 'human' | null>(null);
  const hadStateRef = useRef(false);
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [copied, setCopied] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [guessError, setGuessError] = useState<string | null>(null);
  const [pendingGuess, setPendingGuess] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);

  const matchUrl = `${window.location.origin}/game/${sessionId}`;

  function sendMsg(msg: object) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function handleSubmitGuess(word: string) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setGuessError('Connection lost — please wait a moment and try again.');
      return;
    }
    setPendingGuess(true);
    setGuessError(null);
    sendMsg({ type: 'submit-guess', word });
  }

  function handleNextRound() {
    sendMsg({ type: 'next-round' });
  }

  function handleRequestHint() {
    sendMsg({ type: 'request-hint' });
  }

  function handleAcceptHint() {
    sendMsg({ type: 'accept-hint' });
  }

  function handleRejectHint() {
    sendMsg({ type: 'reject-hint' });
  }

  function handleGiveUp(scope: 'round' | 'game') {
    sendMsg({ type: 'give-up', scope });
  }

  function handleAcceptGiveUp() {
    sendMsg({ type: 'accept-give-up' });
  }

  function handleRejectGiveUp() {
    sendMsg({ type: 'reject-give-up' });
  }

  useEffect(() => {
    if (!sessionId) { navigate('/'); return; }

    let closedByUs = false;
    let hadError = false;

    setLobbyState('connecting');
    setPendingGuess(false);

    const apiUrl = import.meta.env.VITE_API_URL;
    const wsUrl = apiUrl
      ? `${apiUrl.replace(/^http/, 'ws')}/signal`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/signal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', sessionId }));

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMsg;

      if (msg.type === 'joined') {
        setRole(msg.role);
        setLobbyState(msg.role === 'guest' ? 'ready' : 'waiting');
        return;
      }

      if (msg.type === 'game-state') {
        // Fresh quick-match game: pause on the lobby to reveal who you got
        if (
          !hadStateRef.current && isQuickMatch &&
          msg.state.round === 1 && msg.state.guesses.length === 0 && msg.state.phase === 'playing'
        ) {
          setMatchReveal(msg.state.vsBot ? 'bot' : 'human');
          setTimeout(() => setMatchReveal(null), 1600);
        }
        hadStateRef.current = true;
        setGameState(msg.state);
        setPendingGuess(false);
        setGuessError(null);
        setLobbyState('ready');
        return;
      }

      if (msg.type === 'guess-rejected') {
        setGuessError(msg.reason);
        setPendingGuess(false);
        return;
      }

      if (msg.type === 'error') {
        hadError = true;
        setLobbyState('error');
      }
    };

    ws.onerror = () => { hadError = true; setLobbyState('error'); };

    ws.onclose = () => {
      if (closedByUs || hadError) return;
      setTimeout(() => setRetryCount((c) => c + 1), 1500);
    };

    return () => { closedByUs = true; ws.close(); };
  }, [sessionId, navigate, retryCount]);

  // A "Play Again" navigation swaps the sessionId without remounting this
  // component — clear the finished match's state or it would render forever
  useEffect(() => {
    setGameState(null);
    setRole(null);
    setGuessError(null);
    setMatchReveal(null);
    hadStateRef.current = false;
  }, [sessionId]);

  // Cosmetic countdown while quick-match searches; the server attaches the
  // bot on its own timer regardless
  useEffect(() => {
    if (!isQuickMatch || lobbyState !== 'waiting') return;
    setSecondsLeft(Math.ceil(botDelayMs / 1000));
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isQuickMatch, lobbyState, botDelayMs]);

  function copyUrl() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(matchUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const el = document.createElement('textarea');
      el.value = matchUrl;
      el.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (gameState !== null && matchReveal === null) {
    return (
      <GameView
        state={gameState}
        myRole={role!}
        onSubmitGuess={handleSubmitGuess}
        onNextRound={handleNextRound}
        onRequestHint={handleRequestHint}
        onAcceptHint={handleAcceptHint}
        onRejectHint={handleRejectHint}
        onGiveUp={handleGiveUp}
        onAcceptGiveUp={handleAcceptGiveUp}
        onRejectGiveUp={handleRejectGiveUp}
        guessError={guessError}
        pendingGuess={pendingGuess}
      />
    );
  }

  return (
    <div
      className="bg-slate-950 text-white flex flex-col items-center justify-center px-6"
      style={{ minHeight: '100dvh' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-10">

        <div className="text-center">
          <h1 className="text-6xl font-bold tracking-tight">Proximo</h1>
          <p className="text-slate-500 text-sm mt-2">real-time word duel</p>
        </div>

        <div className="w-full flex gap-4">
          <PlayerSlot
            label={role === 'guest' ? 'Host' : 'You'}
            connected={lobbyState !== 'connecting'}
            isMe={role !== 'guest'}
          />
          <PlayerSlot
            label={
              matchReveal
                ? (role === 'guest' ? 'You' : matchReveal === 'bot' ? 'CloserBot' : 'Player')
                : lobbyState === 'ready'
                  ? (role === 'guest' ? 'You' : isQuickMatch ? 'Opponent' : 'Friend')
                  : '…'
            }
            connected={matchReveal !== null || lobbyState === 'ready'}
            isMe={role === 'guest'}
            avatar={matchReveal === 'bot' && role !== 'guest' ? '🤖' : undefined}
          />
        </div>

        {lobbyState === 'connecting' && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
            Connecting…
          </div>
        )}

        {matchReveal && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-emerald-400 font-semibold">
                Matched with {matchReveal === 'bot' ? 'CloserBot 🤖' : 'a player'}!
              </p>
            </div>
            <p className="text-slate-500 text-sm">Game starting…</p>
          </div>
        )}

        {!matchReveal && lobbyState === 'waiting' && isQuickMatch && (
          <div className="w-full flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-slate-300 font-medium">
                {secondsLeft === 0 ? 'Summoning CloserBot…' : 'Finding an opponent…'}
              </p>
            </div>
            <p className="text-slate-500 text-sm text-center">
              {secondsLeft === 0
                ? 'No humans around — a bot will step in.'
                : `If nobody shows up${secondsLeft !== null ? ` in ${secondsLeft}s` : ''}, you'll play our bot.`}
            </p>
          </div>
        )}

        {lobbyState === 'waiting' && !isQuickMatch && (
          <div className="w-full flex flex-col gap-3">
            <p className="text-slate-400 text-sm text-center">Send this link to your friend:</p>
            <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
              <p className="text-slate-300 text-xs font-mono px-4 py-3 truncate border-b border-slate-800">
                {matchUrl}
              </p>
              <button
                onClick={copyUrl}
                className={`w-full py-3 text-sm font-semibold transition-colors ${
                  copied ? 'bg-emerald-900 text-emerald-400' : 'bg-slate-800 active:bg-slate-700 text-white'
                }`}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        )}

        {!matchReveal && lobbyState === 'ready' && gameState === null && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-emerald-400 font-semibold">Both players connected!</p>
            </div>
            <p className="text-slate-500 text-sm">Game starting…</p>
          </div>
        )}

        {lobbyState === 'error' && (
          <div className="w-full flex flex-col items-center gap-4">
            <div className="w-full bg-red-950/50 border border-red-800/50 rounded-2xl px-4 py-4 text-center">
              <p className="text-red-400 font-medium">Connection failed.</p>
              <p className="text-slate-500 text-sm mt-1">The session may have expired.</p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="bg-slate-800 active:bg-slate-700 text-white text-sm font-medium px-6 py-3 rounded-xl transition-colors"
            >
              Back to Home
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

function PlayerSlot({ label, connected, isMe, avatar }: { label: string; connected: boolean; isMe: boolean; avatar?: string }) {
  return (
    <div className={`flex-1 flex flex-col items-center gap-2 py-4 rounded-2xl border transition-colors ${
      connected
        ? isMe ? 'border-emerald-700 bg-emerald-950/40' : 'border-slate-600 bg-slate-900'
        : 'border-slate-800 bg-slate-900/50'
    }`}>
      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${connected ? 'bg-slate-700' : 'bg-slate-800'}`}>
        {connected ? avatar ?? '👤' : '?'}
      </div>
      <span className={`text-sm font-medium ${connected ? 'text-white' : 'text-slate-600'}`}>{label}</span>
      <span className={`text-xs ${connected ? (isMe ? 'text-emerald-500' : 'text-slate-400') : 'text-slate-700'}`}>
        {connected ? 'connected' : 'waiting'}
      </span>
    </div>
  );
}
