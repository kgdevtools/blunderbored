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
];

const builtFeatures = features.filter((f) => f.status !== 'planned');

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <h1 className="text-3xl font-bold mb-8">Blunderbored</h1>

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
    </main>
  );
}
