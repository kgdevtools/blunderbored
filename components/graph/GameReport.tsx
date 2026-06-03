'use client';
import { useMemo } from 'react';
import type { GameReview, ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
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

// ── Swing (win%-loss) + clock time, sharing the move axis ──────────────────────
function SwingTimeBars({
  moves, spent, remaining, currentMoveIndex, onSelectMove,
}: {
  moves: ReviewedMove[];
  spent: (number | null)[] | null;
  remaining: number[] | null;
  currentMoveIndex: number;
  onSelectMove: (i: number) => void;
}) {
  const n = moves.length;
  const W = 1000, Hs = 90, Ht = spent ? 50 : 0, gap = spent ? 6 : 0, H = Hs + gap + Ht;
  const bw = n > 0 ? W / n : 0;
  const maxLoss = Math.max(20, ...moves.map((m) => m.winPctLoss));
  const maxSpent = spent ? Math.max(1, ...spent.map((s) => s ?? 0)) : 1;

  const pick = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return Math.floor(frac * n);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full cursor-pointer touch-none"
      style={{ height: H * 0.42 }}
      onPointerDown={(e) => onSelectMove(pick(e.clientX, e.currentTarget))}
    >
      {moves.map((m, i) => {
        const h = (m.winPctLoss / maxLoss) * Hs;
        const isCur = i === currentMoveIndex;
        return (
          <rect
            key={`s${i}`}
            x={i * bw + bw * 0.1}
            y={Hs - h}
            width={bw * 0.8}
            height={Math.max(0, h)}
            fill={QUALITY_META[m.quality].hex}
            opacity={isCur ? 1 : m.quality === 'good' || m.quality === 'book' ? 0.25 : 0.85}
          />
        );
      })}
      {spent && remaining && spent.map((s, i) => {
        if (s == null) return null;
        const h = (s / maxSpent) * Ht;
        const trouble = remaining[i] != null && remaining[i] < 10;
        return (
          <rect
            key={`t${i}`}
            x={i * bw + bw * 0.1}
            y={Hs + gap + (Ht - h)}
            width={bw * 0.8}
            height={Math.max(0, h)}
            fill={trouble ? '#ef4444' : '#52525b'}
            opacity={i === currentMoveIndex ? 1 : 0.8}
          />
        );
      })}
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 leading-none">{label}</span>
      <span className="text-lg font-bold tabular-nums text-zinc-100 leading-tight">{value}</span>
      {sub && <span className="text-[10px] text-zinc-500 leading-none">{sub}</span>}
    </div>
  );
}

export function GameReport({ review, originalPgn, currentMoveIndex, onSelectMove, onClose }: GameReportProps) {
  const report = useMemo(() => buildReport(review), [review]);
  const clocks = useMemo(() => parseClocks(originalPgn), [originalPgn]);
  const games = useAllGames();
  const analysedCount = games.filter((g) => g.reviewData).length;

  const cur = currentMoveIndex >= 0 ? review.moves[currentMoveIndex] : null;
  const notes = cur ? ([
    ['King', cur.kmaps.kingSafety],
    ['Activity', cur.kmaps.activity],
    ['Pawns', cur.kmaps.pawnStructure],
    ['Space', cur.kmaps.space],
  ] as const).filter(([, v]) => v) : [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <span className="text-sm font-bold tracking-tight text-zinc-100">Game Report</span>
        <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" aria-label="Close report">
          <XIcon />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 font-[family-name:var(--font-jetbrains-mono)]">
        {/* Eval curve */}
        <EvalCurve moves={review.moves} currentMoveIndex={currentMoveIndex} onSelectMove={onSelectMove} />

        {/* Accuracy / ACPL / expected score */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs font-bold text-zinc-300">White</div>
            <div className="flex gap-4">
              <Stat label="Accuracy" value={`${review.whiteSummary.accuracy.toFixed(1)}%`} />
              <Stat label="ACPL" value={`${report.acpl.w}`} />
              <Stat label="xScore" value={report.expected.w.toFixed(2)} sub="expected pts" />
            </div>
          </div>
          <div className="space-y-2 border-l border-zinc-800 pl-3">
            <div className="text-xs font-bold text-zinc-300">Black</div>
            <div className="flex gap-4">
              <Stat label="Accuracy" value={`${review.blackSummary.accuracy.toFixed(1)}%`} />
              <Stat label="ACPL" value={`${report.acpl.b}`} />
              <Stat label="xScore" value={report.expected.b.toFixed(2)} sub="expected pts" />
            </div>
          </div>
        </div>

        {/* Accuracy by phase */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Accuracy by phase</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {report.byPhase.map((p) => (
              <div key={p.phase} className="rounded bg-zinc-800/50 px-2 py-1.5">
                <div className="capitalize text-zinc-400 text-[11px]">{p.phase}</div>
                <div className="tabular-nums text-zinc-200">
                  <span className="text-zinc-100">{p.w ?? '—'}</span>
                  <span className="text-zinc-600"> / </span>
                  <span className="text-zinc-400">{p.b ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">White / Black</div>
        </div>

        {/* Swing + time */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Swings{clocks ? ' & time' : ''}</span>
            {!clocks && <span className="text-[10px] text-zinc-600">no clock data</span>}
          </div>
          <SwingTimeBars
            moves={review.moves}
            spent={clocks?.spent ?? null}
            remaining={clocks?.remaining ?? null}
            currentMoveIndex={currentMoveIndex}
            onSelectMove={onSelectMove}
          />
        </div>

        {/* Positional notes (kmaps) for the current move */}
        {notes.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Positional notes</div>
            <div className="space-y-0.5">
              {notes.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs tracking-tightest leading-tight">
                  <span className="w-14 shrink-0 text-zinc-500">{k}</span>
                  <span className="text-zinc-300">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Turning points */}
        {report.turning.length > 0 && (
          <ListSection title="Turning points" moves={report.turning} onSelectMove={onSelectMove} />
        )}

        {/* Let it slip */}
        {report.slipped.length > 0 && (
          <ListSection title="Let it slip (while winning)" moves={report.slipped} onSelectMove={onSelectMove} />
        )}

        {/* Rating estimate (locked) */}
        <div className="rounded border border-zinc-800 px-2.5 py-2">
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

function ListSection({ title, moves, onSelectMove }: { title: string; moves: ReviewedMove[]; onSelectMove: (i: number) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{title}</div>
      <div className="space-y-0.5">
        {moves.map((m) => (
          <button
            key={m.moveIndex}
            onClick={() => onSelectMove(m.moveIndex)}
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-zinc-800"
          >
            <span className="font-mono text-zinc-200 w-16 shrink-0">{moveLabel(m)}</span>
            <span className="font-bold shrink-0" style={{ color: QUALITY_META[m.quality].hex }}>
              {QUALITY_META[m.quality].label}
            </span>
            <span className="ml-auto tabular-nums text-zinc-500">−{m.winPctLoss.toFixed(0)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
