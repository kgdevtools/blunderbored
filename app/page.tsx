import Link from 'next/link';

interface Feature {
  href: string;
  label: string;
  description: string;
  done?: boolean;
}

const features: Feature[] = [
  { href: '/board',             label: 'Board',               description: 'Free-form interactive chess board with engine analysis', done: true },
  { href: '/analysis',          label: 'Game Reviewer',       description: 'Review a full game with engine evaluation and annotations', done: true },
  { href: '/puzzle-generator',  label: 'Puzzle Generator',    description: 'Create training puzzles from mistakes in analysed games' },
  { href: '/position-trainer',  label: 'Position Trainer',    description: 'Practice key positions and patterns' },
  { href: '/learn-from-mistakes', label: 'Learn from Mistakes', description: 'Drill positions where you went wrong' },
  { href: '/coordinate-trainer', label: 'Coordinate Trainer', description: 'Train board coordinate recognition' },
  { href: '/timed-puzzles',     label: 'Timed Puzzles',       description: 'Solve puzzles against the clock' },
  { href: '/position-memory',   label: 'Position Memory',     description: 'Memorise and reconstruct positions' },
  { href: '/four-by-four-flash-quiz', label: '4×4 Flash Quiz', description: 'Fast pattern recognition on a 4×4 grid' },
  { href: '/game-viewer',       label: 'Game Viewer',         description: 'Browse and replay saved games' },
  { href: '/play-with-bot',     label: 'Play with Bot',       description: 'Play a game against Stockfish' },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <h1 className="text-3xl font-bold mb-1">Chess Academy</h1>
      <p className="text-zinc-500 mb-8 text-sm tracking-wide">Analysis &amp; Training Platform</p>

      <div className="w-full max-w-5xl border border-zinc-800 rounded-sm overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800">
          {features.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className={[
                'group relative block p-4 transition-colors',
                f.done
                  ? 'bg-zinc-900 hover:bg-zinc-800'
                  : 'bg-zinc-950 hover:bg-zinc-900',
              ].join(' ')}
            >
              {/* Done indicator */}
              {f.done && (
                <span className="absolute top-3 right-3 text-[10px] font-mono tracking-tight text-green-500 border border-green-800 rounded-sm px-1 leading-4">
                  live
                </span>
              )}

              <div className={`font-semibold text-sm mb-0.5 ${f.done ? 'text-white' : 'text-zinc-400'}`}>
                {f.label}
              </div>
              <div className="text-xs text-zinc-500 leading-snug">
                {f.description}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
