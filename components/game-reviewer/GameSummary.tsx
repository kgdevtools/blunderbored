'use client';
import { GameReview } from '@/lib/analysis';
import { MoveQuality, QUALITY_META } from '@/lib/accuracy';

const ALL_TIERS: MoveQuality[] = ['book', 'inaccuracy', 'mistake', 'blunder'];

interface GameSummaryProps {
  review: GameReview;
}

export function GameSummary({ review }: GameSummaryProps) {
  const { whiteSummary, blackSummary } = review;
  const tiers = ALL_TIERS.filter(q => (whiteSummary.counts[q] ?? 0) > 0 || (blackSummary.counts[q] ?? 0) > 0);

  const sides = [
    { name: 'White', summary: whiteSummary },
    { name: 'Black', summary: blackSummary },
  ] as const;

  return (
    <div className="border border-zinc-700 rounded p-2.5 grid grid-cols-2 gap-x-4 text-sm shrink-0 mb-2">
      {sides.map(({ name, summary }, i) => (
        <div key={name} className={i === 1 ? 'border-l border-zinc-800 pl-4' : ''}>
          {/* Player + accuracy */}
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-base font-bold tracking-tight text-zinc-100">{name}</span>
            <span className="leading-none">
              <span className="text-xl font-bold tabular-nums text-zinc-100">{summary.accuracy.toFixed(1)}</span>
              <span className="text-xs text-zinc-400">%</span>
            </span>
          </div>

          {/* Classifiers, listed vertically under each player */}
          {tiers.length > 0 && (
            <div className="space-y-0.5">
              {tiers.map(q => {
                const meta = QUALITY_META[q];
                return (
                  <div key={q} className="flex items-center gap-1.5 text-xs">
                    <span className={`font-mono font-bold w-3 shrink-0 ${meta.color}`}>{meta.symbol}</span>
                    <span className="text-zinc-400 flex-1 truncate">{meta.label}</span>
                    <span className="text-zinc-200 tabular-nums">{summary.counts[q] ?? 0}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
