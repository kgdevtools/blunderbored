'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewLogEvent, LiveMoveEvent } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';

const PHASE_LABEL: Record<'scan' | 'deep', string> = {
  scan: 'Pass 1/2 — scanning',
  deep: 'Pass 2/2 — deep analysis',
};

function formatEvalCp(cp: number): string {
  if (cp >= 9900) return '+M';
  if (cp <= -9900) return '−M';
  const abs = (Math.abs(cp) / 100).toFixed(1);
  return cp >= 0 ? `+${abs}` : `−${abs}`;
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// One humanized log line: "26. Bh4 ! +1.3 Best" + the engine's best line.
function MoveLogLine({ m }: { m: LiveMoveEvent }) {
  const meta = QUALITY_META[m.quality];
  const num = `${m.moveNum}${m.color === 'b' ? '…' : '.'}`;
  return (
    <div className="px-3 py-1 border-b border-zinc-800/60 last:border-b-0">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] text-zinc-600 tabular-nums w-8 shrink-0 text-right">{num}</span>
        <span className="font-mono text-xs font-semibold text-zinc-100">{m.san}</span>
        {meta.symbol && <span className={`font-mono text-xs font-bold ${meta.color}`}>{meta.symbol}</span>}
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">{formatEvalCp(m.evalAfterCp)}</span>
        <span className={`text-[10px] font-medium ${meta.color}`}>{meta.label}</span>
        {m.phase === 'deep' && (
          <span className="ml-auto text-[9px] uppercase tracking-wide text-blue-400/80 shrink-0">deep</span>
        )}
      </div>
      {m.bestLineSan.length > 0 && (
        <div className="pl-9 font-mono text-[10px] text-zinc-500 leading-snug truncate">
          best {m.bestLineSan.join(' ')}
        </div>
      )}
    </div>
  );
}

// Analysis run modal (progress + stats + live humanized log), shared between
// ReviewerShell and PuzzleGeneratorShell — both drive an identical
// useGameReviewer() analysis pass and want the same loading experience.
// While it runs, the shells replay each analysed move on the board behind it.
export function AnalysisModal({
  progress, logs, moveEvents, startedAt, onHide,
}: {
  progress: { phase: 'scan' | 'deep'; current: number; total: number };
  logs: ReviewLogEvent[];
  moveEvents: LiveMoveEvent[];
  startedAt: number | null;
  onHide: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  // Plain ticking timer — humanized "Elapsed", independent of log traffic.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = startedAt ? now - startedAt : 0;

  // The log renders move lines (primary) merged with warnings/errors only —
  // the old per-position engine chatter stays in the dev console.
  const items = useMemo(() => {
    const merged: Array<{ ts: number; kind: 'move'; m: LiveMoveEvent } | { ts: number; kind: 'text'; l: ReviewLogEvent }> = [];
    for (const m of moveEvents) merged.push({ ts: m.ts, kind: 'move', m });
    for (const l of logs) if (l.level !== 'info') merged.push({ ts: l.ts, kind: 'text', l });
    return merged.sort((a, b) => a.ts - b.ts);
  }, [moveEvents, logs]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [items.length]);

  // Moves, not positions: pass 1 scans in reverse, so the very first event
  // already carries the highest move index — the total is known immediately.
  const movesTotal = moveEvents.length > 0
    ? Math.max(...moveEvents.map((m) => m.moveIndex)) + 1
    : Math.max(0, progress.total - 1);
  const movesDone = new Set(moveEvents.filter((m) => m.phase === 'scan').map((m) => m.moveIndex)).size;
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const elapsedS = elapsedMs / 1000;
  const rate = elapsedS > 1 && movesDone > 0 ? movesDone / elapsedS : null;
  const etaS = rate && progress.phase === 'scan' && movesTotal > movesDone
    ? Math.round((movesTotal - movesDone) / rate)
    : null;

  const stat = (label: string, value: string) => (
    <div className="flex flex-col items-center px-2 py-1">
      <span className="text-sm font-bold tabular-nums text-zinc-100 leading-tight">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header: title + phase, X top-right */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-100">Analysing game</h3>
          <span className="text-xs text-zinc-500">{PHASE_LABEL[progress.phase]}</span>
          <button
            onClick={onHide}
            aria-label="Hide — analysis continues in the background"
            title="Hide — analysis continues in the background"
            className="ml-auto -mr-1.5 -mt-0.5 grid h-7 w-7 place-items-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4">
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Stat tiles — moves (not half-moves), a plain clock, pace, est. left */}
        <div className="px-2 py-1.5 grid grid-cols-4 divide-x divide-zinc-800">
          {stat('moves', movesTotal ? `${Math.min(movesDone, movesTotal)}/${movesTotal}` : '—')}
          {stat('elapsed', formatClock(elapsedMs))}
          {stat('speed', rate ? `${rate.toFixed(1)}/s` : '—')}
          {stat('est. left', etaS != null ? `~${formatClock(etaS * 1000)}` : '—')}
        </div>

        {/* Live humanized log — flush to the modal's edges, always the last
            element (flat terminal feel: no side/bottom margins, no border). */}
        <div
          ref={logRef}
          className="h-44 overflow-y-auto bg-zinc-950/90 border-t border-zinc-800"
        >
          {items.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[10px] text-zinc-600">Starting engine…</p>
          ) : (
            items.map((it, i) =>
              it.kind === 'move' ? (
                <MoveLogLine key={i} m={it.m} />
              ) : (
                <div key={i} className={`px-3 py-1 font-mono text-[10px] ${it.l.level === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
                  {it.l.msg}
                </div>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
