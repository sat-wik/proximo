import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<'quick' | 'friend' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function quickMatch() {
    setLoading('quick');
    setError(null);
    try {
      const base = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${base}/quick-match`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { sessionId, botDelayMs } = await res.json();
      navigate(`/game/${sessionId}?quick=${botDelayMs}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach server.');
      setLoading(null);
    }
  }

  async function startMatch() {
    setLoading('friend');
    setError(null);
    try {
      const base = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${base}/session`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { sessionId } = await res.json();
      navigate(`/game/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach server.');
      setLoading(null);
    }
  }

  return (
    <div
      className="bg-slate-950 text-white flex flex-col items-center justify-center px-6"
      style={{ minHeight: '100dvh' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-10">

        <div className="text-center">
          <h1 className="text-7xl font-bold tracking-tight">Proximo</h1>
          <p className="text-slate-400 text-base mt-3 leading-relaxed">
            Two players. One hidden word. Guess by similarity — higher score wins.
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <button
            onClick={quickMatch}
            disabled={loading !== null}
            className="w-full bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
          >
            {loading === 'quick' ? 'Finding a match…' : '⚡ Quick Match'}
          </button>
          <button
            onClick={startMatch}
            disabled={loading !== null}
            className="w-full bg-slate-800 active:bg-slate-700 disabled:opacity-50 border border-slate-700 text-white font-semibold text-base py-4 rounded-2xl transition-colors"
          >
            {loading === 'friend' ? 'Creating…' : 'Play a Friend'}
          </button>
        </div>

        {error && (
          <p className="text-red-400 text-sm text-center -mt-4">{error}</p>
        )}

        <div className="w-full flex flex-col gap-3">
          <Hint icon="🎯" text="Guess words. Closer = lower rank & more points" />
          <Hint icon="⚔️" text="Land the target word to end the round." />
          <Hint icon="🏆" text="Highest total score after 3 rounds wins." />
        </div>

      </div>
    </div>
  );
}

function Hint({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
      <span className="text-xl">{icon}</span>
      <p className="text-slate-400 text-sm">{text}</p>
    </div>
  );
}
