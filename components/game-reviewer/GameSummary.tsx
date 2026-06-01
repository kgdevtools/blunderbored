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

  return (
    <div className="border border-zinc-700 rounded p-2.5 space-y-2 text-sm shrink-0 mb-2">
      {/* Accuracy header */}
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none mb-0.5">White</div>
          <span className="text-lg font-bold tabular-nums">{whiteSummary.accuracy.toFixed(1)}</span>
          <span className="text-xs text-zinc-400">%</span>
        </div>
        <div className="text-xs text-zinc-500">accuracy</div>
        <div className="text-right">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none mb-0.5">Black</div>
          <span className="text-lg font-bold tabular-nums">{blackSummary.accuracy.toFixed(1)}</span>
          <span className="text-xs text-zinc-400">%</span>
        </div>
      </div>

      {/* Per-tier counts: icon | name | W count | B count */}
      {tiers.length > 0 && (
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-2 gap-y-0.5 items-center text-xs">
          <div className="col-span-2" />
          <span className="text-[10px] text-zinc-500 text-center uppercase tracking-wide">W</span>
          <span className="text-[10px] text-zinc-500 text-center uppercase tracking-wide">B</span>

          {tiers.map(q => {
            const meta = QUALITY_META[q];
            return (
              <>
                <span key={`icon-${q}`} className={`font-mono font-bold ${meta.color}`}>{meta.symbol}</span>
                <span key={`lbl-${q}`} className="text-zinc-400">{meta.label}</span>
                <span key={`w-${q}`} className="text-zinc-200 tabular-nums text-center">{whiteSummary.counts[q] ?? 0}</span>
                <span key={`b-${q}`} className="text-zinc-400 tabular-nums text-center">{blackSummary.counts[q] ?? 0}</span>
              </>
            );
          })}
        </div>
      )}
    </div>
  );
}
