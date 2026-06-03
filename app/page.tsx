import Link from 'next/link';

type Status = 'live' | 'dev' | 'planned';

interface Feature {
  href: string;
  label: string;
  description: string;
  status: Status;
}

const features: Feature[] = [
  { href: '/board',             label: 'Board',               description: 'Free-form interactive chess board with engine analysis', status: 'live' },
  { href: '/analysis',          label: 'Game Reviewer',       description: 'Review a full game with engine evaluation and annotations', status: 'dev' },
  { href: '/puzzle-generator',  label: 'Puzzle Generator',    description: 'Create training puzzles from mistakes in analysed games', status: 'planned' },
  { href: '/position-trainer',  label: 'Position Trainer',    description: 'Practice key positions and patterns', status: 'planned' },
  { href: '/learn-from-mistakes', label: 'Learn from Mistakes', description: 'Drill positions where you went wrong', status: 'planned' },
  { href: '/coordinate-trainer', label: 'Coordinate Trainer', description: 'Train board coordinate recognition', status: 'planned' },
  { href: '/timed-puzzles',     label: 'Timed Puzzles',       description: 'Solve puzzles against the clock', status: 'planned' },
  { href: '/position-memory',   label: 'Position Memory',     description: 'Memorise and reconstruct positions', status: 'planned' },
  { href: '/four-by-four-flash-quiz', label: '4×4 Flash Quiz', description: 'Fast pattern recognition on a 4×4 grid', status: 'planned' },
  { href: '/game-viewer',       label: 'Game Viewer',         description: 'Browse and replay saved games', status: 'planned' },
  { href: '/play-with-bot',     label: 'Play with Bot',       description: 'Play a game against Stockfish', status: 'planned' },
];

const builtFeatures = features.filter((f) => f.status !== 'planned');
const plannedFeatures = features.filter((f) => f.status === 'planned');

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <h1 className="text-3xl font-bold mb-1">Blunderbored</h1>
      <p className="text-zinc-500 mb-8 text-sm tracking-wide">Analysis &amp; Training Platform</p>

      <div className="w-full max-w-5xl border border-zinc-800 rounded-sm overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800">
          {builtFeatures.map((f) =>
            f.status === 'dev' ? (
              // In development — shown but disabled/greyed out
              <div
                key={f.href}
                aria-disabled="true"
                title="In development"
                className="relative block p-4 bg-zinc-950 opacity-50 cursor-not-allowed select-none"
              >
                <span className="absolute top-3 right-3 text-[10px] font-mono tracking-tight text-amber-500 border border-amber-800/60 rounded-sm px-1 leading-4">
                  in dev
                </span>
                <div className="font-semibold text-sm mb-0.5 text-zinc-400">
                  {f.label}
                </div>
                <div className="text-xs text-zinc-600 leading-snug">
                  {f.description}
                </div>
              </div>
            ) : (
              <Link
                key={f.href}
                href={f.href}
                className="group relative block p-4 transition-colors bg-zinc-900 hover:bg-zinc-800"
              >
                <div className="font-semibold text-sm mb-0.5 text-white">
                  {f.label}
                </div>
                <div className="text-xs text-zinc-500 leading-snug">
                  {f.description}
                </div>
              </Link>
            )
          )}
        </div>
      </div>

      {/* Not-yet-built features, collapsed by default */}
      <details className="w-full max-w-5xl mt-4 group">
        <summary className="cursor-pointer list-none text-xs font-mono tracking-wide text-zinc-500 hover:text-zinc-300 select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">▸</span>
          Coming soon ({plannedFeatures.length})
        </summary>

        <div className="mt-2 border border-zinc-800 rounded-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800">
            {plannedFeatures.map((f) => (
              <div
                key={f.href}
                aria-disabled="true"
                className="relative block p-4 bg-zinc-950 opacity-60 cursor-not-allowed select-none"
              >
                <div className="font-semibold text-sm mb-0.5 text-zinc-400">
                  {f.label}
                </div>
                <div className="text-xs text-zinc-600 leading-snug">
                  {f.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>
    </main>
  );
}
