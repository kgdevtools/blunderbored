'use client';
import { useMemo } from 'react';
import type { GameReview, ReviewedMove } from '@/lib/analysis';
import { QUALITY_META, winP } from '@/lib/accuracy';
import { buildReport, RATING_UNLOCK_AT } from '@/lib/report';
import { parseClocks } from '@/lib/clock';
import { useAllGames } from '@/hooks/useLibrary';
import { EvalCurve } from './EvalCurve';

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

// ── Combined chart: time-spent bars (right axis, secs) + eval line (left axis) ──
function EvalTimeChart({
  moves, spent, remaining, currentMoveIndex, onSelectMove,
}: {
  moves: ReviewedMove[];
  spent: (number | null)[];
  remaining: number[];
  currentMoveIndex: number;
  onSelectMove: (i: number) => void;
}) {
  const n = moves.length;
  const W = 1000, H = 200, PAD = 6;
  const bw = n > 0 ? W / n : 0;
  const xc = (i: number) => (i + 0.5) * bw;                       // bar/point centre
  const maxSpent = Math.max(1, ...spent.map((s) => s ?? 0));
  const yEval = (winPct: number) => H - PAD - (winPct / 100) * (H - 2 * PAD);
  const yTime = (s: number) => H - (s / maxSpent) * (H - PAD);    // bars grow up from baseline

  const linePts = moves.map((m, i) => `${xc(i).toFixed(1)},${yEval(winP(m.evalAfter)).toFixed(1)}`);
  const linePath = linePts.length ? 'M' + linePts.join(' L') : '';

  // Axes (HTML overlay — SVG text would stretch).
  const evalTicks = [500, 200, 0, -200, -500].map((cp) => ({
    label: cp === 0 ? '0' : `${cp > 0 ? '+' : '−'}${Math.abs(cp) / 100}`,
    topPct: (yEval(winP(cp)) / H) * 100,
  }));
  const timeTicks = [0, 0.5, 1].map((f) => ({
    label: `${Math.round(maxSpent * f)}s`,
    topPct: (yTime(maxSpent * f) / H) * 100,
  }));
  const xTicks = useMemo(() => {
    if (n === 0) return [];
    const seen = new Set<number>();
    return [0, 0.25, 0.5, 0.75, 1]
      .map((f) => Math.round(f * (n - 1)))
      .filter((i) => (seen.has(i) ? false : (seen.add(i), true)))
      .map((i) => ({ label: `${Math.floor(i / 2) + 1}`, leftPct: (xc(i) / W) * 100 }));
  }, [n]);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return Math.floor(frac * n);
  };

  return (
    <div className="relative w-full select-none">
      <div className="flex items-center justify-between mb-1 text-[9px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-zinc-300 inline-block" /> eval</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-zinc-500 inline-block rounded-[1px]" /> time / move</span>
      </div>
      <div className="flex">
        {/* left axis — eval */}
        <div className="relative w-8 shrink-0 h-28 text-[9px] tabular-nums text-zinc-500">
          {evalTicks.map((t) => (
            <span key={t.label} className="absolute right-1 -translate-y-1/2" style={{ top: `${t.topPct}%` }}>{t.label}</span>
          ))}
        </div>
        {/* chart */}
        <div className="relative flex-1 h-28">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-full cursor-pointer touch-none"
            onPointerDown={(e) => onSelectMove(pick(e.clientX, e.currentTarget))}
          >
            {/* time bars, coloured by move quality */}
            {spent.map((s, i) => {
              if (s == null) return null;
              const top = yTime(s);
              const trouble = remaining[i] != null && remaining[i] < 10;
              const q = QUALITY_META[moves[i].quality];
              return (
                <rect
                  key={i}
                  x={i * bw + bw * 0.15}
                  y={top}
                  width={bw * 0.7}
                  height={Math.max(0, H - top)}
                  fill={trouble ? '#ef4444' : q.hex}
                  opacity={i === currentMoveIndex ? 1 : moves[i].quality === 'good' || moves[i].quality === 'book' ? 0.3 : 0.7}
                />
              );
            })}
            {/* eval gridlines */}
            {evalTicks.map((t) => (
              <line key={t.label} x1={0} y1={(t.topPct / 100) * H} x2={W} y2={(t.topPct / 100) * H}
                stroke="#52525b" strokeWidth={1} strokeDasharray={t.label === '0' ? '0' : '3 6'} opacity={t.label === '0' ? 0.6 : 0.3} />
            ))}
            {/* eval line overlay */}
            {linePath && <path d={linePath} fill="none" stroke="#e4e4e7" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {/* current marker */}
            {currentMoveIndex >= 0 && currentMoveIndex < n && (
              <line x1={xc(currentMoveIndex)} y1={0} x2={xc(currentMoveIndex)} y2={H} stroke="#3b82f6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        </div>
        {/* right axis — time */}
        <div className="relative w-8 shrink-0 h-28 text-[9px] tabular-nums text-zinc-500">
          {timeTicks.map((t) => (
            <span key={t.label} className="absolute left-1 -translate-y-1/2" style={{ top: `${t.topPct}%` }}>{t.label}</span>
          ))}
        </div>
      </div>
      {/* x axis — move numbers, between the gutters */}
      <div className="relative mx-8 h-3 mt-0.5 text-[9px] tabular-nums text-zinc-500">
        {xTicks.map((t, i) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${t.leftPct}%` }}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

function PlayerAccuracy({ side, accuracy, acpl, xscore, divider }: { side: string; accuracy: number; acpl: number; xscore: number; divider?: boolean }) {
  return (
    <div className={divider ? 'border-l border-zinc-800 pl-3' : ''}>
      <div className="text-xs font-bold text-zinc-300">{side}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 leading-none mt-1">Accuracy</div>
      <div className="text-2xl font-bold tabular-nums text-zinc-100 leading-none">{accuracy.toFixed(1)}%</div>
      <div className="text-[10px] text-zinc-500 mt-1 leading-tight tabular-nums">
        ACPL <span className="text-zinc-300">{acpl}</span>
        <span className="mx-1 text-zinc-700">·</span>
        xScore <span className="text-zinc-300">{xscore.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function GameReport({ review, originalPgn, currentMoveIndex, onSelectMove, onClose }: GameReportProps) {
  const report = useMemo(() => buildReport(review), [review]);
  const clocks = useMemo(() => parseClocks(originalPgn), [originalPgn]);
  const games = useAllGames();
  const analysedCount = games.filter((g) => g.reviewData).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <span className="text-sm font-bold tracking-tight text-zinc-100">Game Report</span>
        <button onClick={onClose} className="p-1 rounded-[2px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" aria-label="Close report">
          <XIcon />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 font-[family-name:var(--font-jetbrains-mono)]">
        {/* Eval curve */}
        <EvalCurve moves={review.moves} currentMoveIndex={currentMoveIndex} onSelectMove={onSelectMove} />

        {/* Accuracy — % prominent, ACPL/xScore small below */}
        <div className="grid grid-cols-2 gap-3">
          <PlayerAccuracy side="White" accuracy={review.whiteSummary.accuracy} acpl={report.acpl.w} xscore={report.expected.w} />
          <PlayerAccuracy side="Black" accuracy={review.blackSummary.accuracy} acpl={report.acpl.b} xscore={report.expected.b} divider />
        </div>

        {/* Accuracy by phase — labelled White/Black rather than an x / y slash */}
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

        {/* Eval & time — combined chart, only when the PGN carried clock data */}
        {clocks && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Eval &amp; time</div>
            <EvalTimeChart
              moves={review.moves}
              spent={clocks.spent}
              remaining={clocks.remaining}
              currentMoveIndex={currentMoveIndex}
              onSelectMove={onSelectMove}
            />
          </div>
        )}

        {/* Turning points */}
        {report.turning.length > 0 && (
          <MomentList title="Turning points" moves={report.turning} onSelectMove={onSelectMove} />
        )}

        {/* Let it slip */}
        {report.slipped.length > 0 && (
          <MomentList title="Let it slip (while winning)" moves={report.slipped} onSelectMove={onSelectMove} />
        )}

        {/* Rating estimate (locked) */}
        <div className="rounded-[2px] border border-zinc-800 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">Rating estimate</span>
            <span className="text-[10px] text-zinc-500">{Math.min(analysedCount, RATING_UNLOCK_AT)}/{RATING_UNLOCK_AT}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (analysedCount / RATING_UNLOCK_AT) * 100)}%` }} />
          </div>
          <p className="text-[10px] text-zinc-500 mt-1 leading-tight">
            Unlocks after {RATING_UNLOCK_AT} analysed games — single-game estimates are too noisy to be meaningful.
          </p>
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
