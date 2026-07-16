interface Props {
  onClose: () => void;
}

export default function RulesModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-6 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 text-center">
          <p className="text-2xl mb-1">🎯</p>
          <p className="text-white font-semibold text-lg">How to Play</p>
        </div>

        <div className="px-5 pb-4 flex flex-col gap-4 text-sm">
          <Rule title="The goal">
            Each round hides a secret target word. You and your opponent take turns
            guessing single words — the closer your word is in <em>meaning</em>, the
            better its rank. Rank #1 is the target itself; #20,000 is totally unrelated.
          </Rule>

          <Rule title="Scoring">
            Every guess earns <span className="text-white font-medium">20,000 ÷ rank</span> points
            — a rank #100 word scores 200, a rank #4,000 word scores 5.{' '}
            <span className="text-white font-medium">Highest total score wins.</span>
          </Rule>

          <Rule title="Steals & streaks 🔥">
            Beat the best rank on the board and you <em>steal</em> the lead for a{' '}
            <span className="text-white font-medium">+500 bonus</span>. Steal on consecutive
            guesses and the bonus multiplies — that's the fire streak.
          </Rule>

          <Rule title="The kill">
            Guess the exact target word to end the round and bank{' '}
            <span className="text-white font-medium">20,000 points</span>. Watch your
            opponent's best words — they're clues you can snipe from.
          </Rule>

          <Rule title="The match">
            Best of 3 rounds; whoever loses a round goes first in the next. The highest
            combined total across all rounds takes the match.
          </Rule>

          <Rule title="Hints & giving up">
            Stuck after 50 guesses? Request an AI hint — your opponent must agree (max 3
            per round). You can also give up a round or the match, but if you're{' '}
            <em>leading</em>, your opponent has to accept.
          </Rule>

          <Rule title="Opponents">
            Quick Match pairs you with whoever's online — or CloserBot steps in if no
            human shows up within 20 seconds. Prefer a friend? Create a match and share
            the link.
          </Rule>
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-white font-semibold mb-1">{title}</p>
      <p className="text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}
