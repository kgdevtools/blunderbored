'use client';
import { useMemo } from 'react';
import type { GameReview, ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
import { buildReport, RATING_UNLOCK_AT } from '@/lib/report';
import { parseClocks } from '@/lib/clock';
import { useAllGames } from '@/hooks/useLibrary';
import { EvalCurve } from './EvalCurve';
import { AccuracyPerMoveChart, type AccSeries } from './AccuracyPerMoveChart';
import { TimePerMoveChart, type TimeBar } from './TimePerMoveChart';

interface GameReportProps {
  review: GameReview;
  originalPgn: string;
  currentMoveIndex: number;
  onSelectMove: (i: number) => void;
  onClose: () => void;
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function moveLabel(m: ReviewedMove): string {
  return `${Math.floor(m.moveIndex / 2) + 1}${m.color === 'w' ? '.' : '…'} ${m.moveSan}`;
}

// Quality tiers that earn a dot on the accuracy line.
const DOT_TIERS = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

function PlayerAccuracy({ side, accuracy, acpl, divider }: { side: string; accuracy: number; acpl: number; divider?: boolean }) {
  return (
    <div className={divider ? 'border-l border-zinc-800 pl-3' : ''}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold text-zinc-300">{side}</span>
        <span className="text-[10px] text-zinc-500 tabular-nums">ACPL <span className="text-zinc-300">{acpl}</span></span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-zinc-100 leading-none mt-0.5">{accuracy.toFixed(1)}<span className="text-sm text-zinc-500">%</span></div>
    </div>
  );
}

export function GameReport({ review, originalPgn, currentMoveIndex, onSelectMove, onClose }: GameReportProps) {
  const report = useMemo(() => buildReport(review), [review]);
  const clocks = useMemo(() => parseClocks(originalPgn), [originalPgn]);
  const games = useAllGames();
  const analysedCount = games.filter((g) => g.reviewData).length;

  // Accuracy-per-move series (one per player; dots on the misses).
  const accSeries = useMemo((): AccSeries[] => {
    const mk = (color: 'w' | 'b', label: string, stroke: string): AccSeries => ({
      label,
      color: stroke,
      points: review.moves
        .filter((m) => m.color === color && !m.unscored)
        .map((m) => ({
          index: m.moveIndex,
          acc: m.moveAccuracy,
          dotHex: DOT_TIERS.has(m.quality) ? QUALITY_META[m.quality].hex : null,
          label: `${moveLabel(m)} ${QUALITY_META[m.quality].symbol} ${m.moveAccuracy.toFixed(0)}%`,
        })),
    });
    return [mk('w', 'W', '#d4d4d8'), mk('b', 'B', '#71717a')];
  }, [review.moves]);

  // Time-per-move bars (only when the PGN carried [%clk] data).
  const timeBars = useMemo((): TimeBar[] => {
    if (!clocks) return [];
    return review.moves
      .map((m, i): TimeBar | null => {
        const s = clocks.spent[i];
        if (s == null) return null;
        return {
          index: m.moveIndex,
          seconds: s,
          side: m.color,
          danger: clocks.remaining[i] != null && clocks.remaining[i] < 10,
          label: `${moveLabel(m)} — ${Math.round(s)}s`,
        };
      })
      .filter((b): b is TimeBar => b !== null);
  }, [clocks, review.moves]);

  // Key moments: turning points ∪ slips, deduped, worst first.
  const keyMoments = useMemo(() => {
    const byIndex = new Map<number, ReviewedMove>();
    for (const m of [...report.turning, ...report.slipped]) byIndex.set(m.moveIndex, m);
    return [...byIndex.values()].sort((a, b) => b.winPctLoss - a.winPctLoss).slice(0, 5);
  }, [report.turning, report.slipped]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-1.5 shrink-0">
        <span className="text-sm font-bold tracking-tight text-zinc-100">Game Report</span>
        <button onClick={onClose} className="p-1 rounded-[2px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" aria-label="Close report">
          <XIcon />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5 font-[family-name:var(--font-jetbrains-mono)]">
        {/* Accuracy duel */}
        <div className="grid grid-cols-2 gap-3">
          <PlayerAccuracy side="White" accuracy={review.whiteSummary.accuracy} acpl={report.acpl.w} />
          <PlayerAccuracy side="Black" accuracy={review.blackSummary.accuracy} acpl={report.acpl.b} divider />
        </div>

        {/* Accuracy per move */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Accuracy per move</div>
          <AccuracyPerMoveChart
            series={accSeries}
            maxIndex={Math.max(1, review.moves.length - 1)}
            currentIndex={currentMoveIndex >= 0 ? currentMoveIndex : null}
            onSelect={onSelectMove}
          />
        </div>

        {/* Eval curve */}
        <EvalCurve moves={review.moves} currentMoveIndex={currentMoveIndex} onSelectMove={onSelectMove} />

        {/* Accuracy by phase */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Accuracy by phase</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {report.byPhase.map((p) => (
              <div key={p.phase} className="rounded-[2px] bg-zinc-800/50 px-2 py-1.5">
                <div className="capitalize text-zinc-400 text-[11px] mb-1">{p.phase}</div>
                <div className="flex items-center justify-between tabular-nums leading-tight">
                  <span className="text-[10px] text-zinc-500">W</span>
                  <span className="text-zinc-100">{p.w != null ? `${p.w}%` : '—'}</span>
                </div>
                <div className="flex items-center justify-between tabular-nums leading-tight">
                  <span className="text-[10px] text-zinc-500">B</span>
                  <span className="text-zinc-300">{p.b != null ? `${p.b}%` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Time per move — only when the PGN carried clock data */}
        {timeBars.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Time per move</div>
            <TimePerMoveChart
              bars={timeBars}
              maxIndex={Math.max(1, review.moves.length - 1)}
              currentIndex={currentMoveIndex >= 0 ? currentMoveIndex : null}
              onSelect={onSelectMove}
            />
          </div>
        )}

        {/* Key moments — turning points and let-it-slips, one deduped list */}
        {keyMoments.length > 0 && (
          <MomentList title="Key moments" moves={keyMoments} onSelectMove={onSelectMove} />
        )}

        {/* Rating estimate (locked) */}
        <div className="rounded-[2px] border border-zinc-800 px-2.5 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">Rating estimate</span>
            <span className="text-[10px] text-zinc-500 tabular-nums">{Math.min(analysedCount, RATING_UNLOCK_AT)}/{RATING_UNLOCK_AT} games</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (analysedCount / RATING_UNLOCK_AT) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Critical-moment list: each move as a card with a quality-coloured left rule,
// the move, its verdict, and the win% it cost.
function MomentList({ title, moves, onSelectMove }: { title: string; moves: ReviewedMove[]; onSelectMove: (i: number) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{title}</div>
      <div className="space-y-1">
        {moves.map((m) => {
          const meta = QUALITY_META[m.quality];
          return (
            <button
              key={m.moveIndex}
              onClick={() => onSelectMove(m.moveIndex)}
              className="flex w-full items-center gap-2.5 rounded-[2px] border-l-2 bg-zinc-800/40 hover:bg-zinc-800 px-2 py-1.5 text-left"
              style={{ borderColor: meta.hex }}
            >
              <span className="font-mono text-zinc-100 text-xs w-16 shrink-0">{moveLabel(m)}</span>
              <span className="text-[11px] font-bold shrink-0" style={{ color: meta.hex }}>{meta.label}</span>
              <span className="ml-auto tabular-nums text-xs font-bold" style={{ color: meta.hex }}>−{m.winPctLoss.toFixed(0)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
