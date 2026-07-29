'use client';
import { useState } from 'react';
import { GameReview } from '@/lib/analysis';
import { MoveQuality, QUALITY_META } from '@/lib/accuracy';

const ALL_TIERS: MoveQuality[] = [
  'brilliant', 'great', 'excellent', 'book', 'forced',
  'inaccuracy', 'mistake', 'miss', 'blunder',
];

interface GameSummaryProps {
  review: GameReview;
}

// Collapsed by default — the header alone (opening + both accuracies) is
// enough at a glance; the full breakdown shouldn't push the board/moves list
// off-screen on mobile.
export function GameSummary({ review }: GameSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const { whiteSummary, blackSummary } = review;
  const tiers = ALL_TIERS.filter(q => (whiteSummary.counts[q] ?? 0) > 0 || (blackSummary.counts[q] ?? 0) > 0);
  // Engine-best moves per side (data already on each ReviewedMove; free insight).
  const bestCount = (side: 'w' | 'b') => review.moves.filter(m => m.color === side && m.best).length;

  const sides = [
    { name: 'White', summary: whiteSummary, best: bestCount('w') },
    { name: 'Black', summary: blackSummary, best: bestCount('b') },
  ] as const;

  return (
    <div className="border border-zinc-700 rounded text-sm shrink-0 mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-2 text-left hover:bg-zinc-900/60 transition-colors rounded"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
          {review.opening ? (
            <>
              <span className="font-mono text-zinc-500 mr-1.5">{review.opening.eco}</span>
              {review.opening.name}
            </>
          ) : 'Game summary'}
        </span>
        <span className="shrink-0 flex items-center gap-2.5 text-xs tabular-nums">
          <span className="text-zinc-300">W {whiteSummary.accuracy.toFixed(1)}%</span>
          <span className="text-zinc-300">B {blackSummary.accuracy.toFixed(1)}%</span>
          <span className={`inline-block text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
        </span>
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-4 px-2.5 pb-2.5 pt-1 border-t border-zinc-800">
          {sides.map(({ name, summary, best }, i) => (
            <div key={name} className={i === 1 ? 'border-l border-zinc-800 pl-4' : ''}>
              {/* Player + accuracy */}
              <div className="flex items-baseline justify-between gap-2 mb-1.5 mt-1.5">
                <span className="text-base font-bold tracking-tight text-zinc-100">{name}</span>
                <span className="leading-none">
                  <span className="text-xl font-bold tabular-nums text-zinc-100">{summary.accuracy.toFixed(1)}</span>
                  <span className="text-xs text-zinc-400">%</span>
                </span>
              </div>

              {/* Classifiers, listed vertically under each player */}
              {(tiers.length > 0 || best > 0) && (
                <div className="space-y-0.5">
                  {best > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono font-bold w-3 shrink-0 text-emerald-400">★</span>
                      <span className="text-zinc-400 flex-1 truncate">Best</span>
                      <span className="text-zinc-200 tabular-nums">{best}</span>
                    </div>
                  )}
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
      )}
    </div>
  );
}
