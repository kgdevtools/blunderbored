'use client';
import { useEffect, useRef } from 'react';
import type { ReviewLogEvent } from '@/lib/analysis';

const PHASE_LABEL: Record<'scan' | 'deep', string> = {
  scan: 'Pass 1/2 — scanning',
  deep: 'Pass 2/2 — deep analysis',
};

const LOG_LEVEL_CLS: Record<ReviewLogEvent['level'], string> = {
  info: 'text-zinc-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

// Analysis run modal (progress + stats + live log), shared between
// ReviewerShell and PuzzleGeneratorShell — both drive an identical
// useGameReviewer() analysis pass and want the same loading experience.
export function AnalysisModal({
  progress, logs, onHide,
}: {
  progress: { phase: 'scan' | 'deep'; current: number; total: number };
  logs: ReviewLogEvent[];
  onHide: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs.length]);

  const { phase, current, total } = progress;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  // Pace + ETA from the run log's own timestamps (the last progress event).
  const last = logs[logs.length - 1];
  const elapsed = last ? last.ts / 1000 : 0;
  const rate = elapsed > 0.5 && current > 0 ? current / elapsed : null;
  const eta = rate && total > current ? Math.round((total - current) / rate) : null;

  const stat = (label: string, value: string) => (
    <div className="flex flex-col items-center px-2 py-1">
      <span className="text-sm font-bold tabular-nums text-zinc-100 leading-tight">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Analysing game</h3>
          <span className="text-xs text-zinc-500">{PHASE_LABEL[phase]}</span>
          <span className="text-xs tabular-nums text-zinc-400">{pct}%</span>
        </div>

        <div className="px-4">
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Stat tiles */}
        <div className="px-2 py-1.5 grid grid-cols-4 divide-x divide-zinc-800">
          {stat('positions', total ? `${current}/${total}` : '—')}
          {stat('elapsed', `${elapsed.toFixed(0)}s`)}
          {stat('pace', rate ? `${rate.toFixed(1)}/s` : '—')}
          {stat('eta', eta != null ? `~${eta}s` : '—')}
        </div>

        {/* Live run log */}
        <div
          ref={logRef}
          className="mx-3 mb-2 h-36 overflow-y-auto rounded bg-zinc-950/80 border border-zinc-800 px-2 py-1.5 font-mono text-[10px] leading-relaxed"
        >
          {logs.length === 0 ? (
            <p className="text-zinc-600">Starting engine…</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={LOG_LEVEL_CLS[l.level]}>
                <span className="text-zinc-600 tabular-nums">{(l.ts / 1000).toFixed(1).padStart(6)}s</span> {l.msg}
              </div>
            ))
          )}
        </div>

        <div className="px-4 pb-3 flex justify-end">
          <button
            onClick={onHide}
            className="px-3 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Continue in the background — progress stays visible in the panel"
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
