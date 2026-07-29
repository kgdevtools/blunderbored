'use client';
import { useEffect, useRef } from 'react';
import { CLASS_META, TIME_META, classifyMoveTime, type BlunderMove } from '@/lib/blunder';
import { MovesViewToggle, useMovesView } from '@/components/common/MovesViewToggle';

// A PGN-intelligent scoresheet for /blunderable, in the spirit of /board's
// MovesList (mono SAN, move-number gutter, scrolls) but trimmed to what this mode
// needs — no annotations/library/context-menus. Two modes:
//   • 'live'   — plain SAN as the game runs (no evals/data, no distractions)
//   • 'report' — adds quality glyph, eval, and a chess.com-style time bar per move
export interface Ply { num: number; color: 'w' | 'b'; san: string; }

const fmtCp = (cp: number) => `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;

interface Cell { ply: Ply; index: number; }
interface Row { num: number; w?: Cell; b?: Cell; }

export function GameMovesList({
  plies, side, moves, mode, clockInitialMs = 180_000, autoScroll = true, className = '', heightClass = 'max-h-44',
  activePly = null, onSelectPly,
}: {
  plies: Ply[];
  side: 'w' | 'b';
  moves?: BlunderMove[];
  mode: 'live' | 'report';
  clockInitialMs?: number;
  autoScroll?: boolean;
  className?: string;
  heightClass?: string;
  /** Review navigation: index of the currently shown ply (−1/null = start). */
  activePly?: number | null;
  onSelectPly?: (index: number) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  // Vertical rows are this scoresheet's native shape; inline is the flowing
  // alternative for a quick shape-of-the-game read.
  const [view, setView] = useMovesView('blunderable', 'vertical');
  useEffect(() => { if (autoScroll) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [plies.length, autoScroll]);
  useEffect(() => {
    if (activePly != null && activePly >= 0) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activePly, view]);

  // The k-th of the player's own plies maps to moves[k] (quality/eval/time).
  const bmByIndex = new Map<number, BlunderMove>();
  if (moves && mode === 'report') {
    let k = 0;
    plies.forEach((p, i) => { if (p.color === side) { if (moves[k]) bmByIndex.set(i, moves[k]); k++; } });
  }
  const maxMs = Math.max(1, ...(moves?.map((m) => m.clockMs) ?? [1]));

  // Group plies into scoresheet rows by fullmove number (handles a game that
  // starts mid-move or on Black's turn — the missing cell just renders blank).
  const rows: Row[] = [];
  let cur: Row | null = null;
  plies.forEach((ply, index) => {
    if (!cur || cur.num !== ply.num) { cur = { num: ply.num }; rows.push(cur); }
    if (ply.color === 'w') cur.w = { ply, index }; else cur.b = { ply, index };
  });

  if (plies.length === 0) {
    return <div className={className}><p className="text-zinc-600 text-xs px-1 py-3">No moves yet.</p></div>;
  }

  const renderCell = (cell?: Cell) => {
    if (!cell) return <span className="text-zinc-700 font-mono">·</span>;
    const isPlayer = cell.ply.color === side;
    const bm = bmByIndex.get(cell.index);
    const meta = bm ? CLASS_META[bm.cls] : null;
    const isActive = activePly === cell.index;
    const body = (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-baseline gap-1 leading-tight">
          <span className={`font-mono ${isActive ? 'text-white font-semibold' : isPlayer ? 'text-zinc-100' : 'text-zinc-400'}`}>{cell.ply.san}</span>
          {mode === 'report' && meta?.glyph && <span className="font-mono font-bold text-xs" style={{ color: meta.color }}>{meta.glyph}</span>}
          {mode === 'report' && bm?.evalCp != null && <span className="font-mono text-[10px] tabular-nums text-zinc-500">{fmtCp(bm.evalCp)}</span>}
        </span>
        {/* chess.com-style time bar — player moves only, in the report */}
        {mode === 'report' && isPlayer && bm && (() => {
          const tcls = classifyMoveTime(bm.clockMs, clockInitialMs);
          const pct = Math.max(5, Math.round((bm.clockMs / maxMs) * 100));
          return (
            <span className="flex items-center gap-1">
              <span className="h-1 rounded-full bg-zinc-800 w-12 overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: TIME_META[tcls].color }} />
              </span>
              <span className="text-[9px] tabular-nums text-zinc-500">{(bm.clockMs / 1000).toFixed(1)}s</span>
            </span>
          );
        })()}
      </div>
    );
    if (!onSelectPly) return body;
    return (
      <div ref={isActive ? activeRef : undefined}>
        <button
          onClick={() => onSelectPly(cell.index)}
          className={`w-full text-left rounded-sm px-1 -mx-1 transition-colors ${isActive ? 'bg-indigo-700/50' : 'hover:bg-zinc-800/60'}`}
        >
          {body}
        </button>
      </div>
    );
  };

  // Inline flowing view — SAN stream with glyph/eval riding along (time bars
  // stay vertical-only; they need the row layout to breathe).
  const renderInlinePly = (cell: Cell) => {
    const isPlayer = cell.ply.color === 'w' ? side === 'w' : side === 'b';
    const bm = bmByIndex.get(cell.index);
    const meta = bm && mode === 'report' ? CLASS_META[bm.cls] : null;
    const isActive = activePly === cell.index;
    const inner = (
      <>
        {cell.ply.color === 'w' && <span className="font-mono text-zinc-600 mr-px">{cell.ply.num}.</span>}
        <span className={`font-mono ${isActive ? 'text-white font-semibold' : isPlayer ? 'text-zinc-100' : 'text-zinc-400'}`}>{cell.ply.san}</span>
        {meta?.glyph && <span className="font-mono font-bold text-xs ml-px" style={{ color: meta.color }}>{meta.glyph}</span>}
        {mode === 'report' && bm?.evalCp != null && (
          <span className="font-mono text-[10px] tabular-nums text-zinc-500 ml-0.5">{fmtCp(bm.evalCp)}</span>
        )}
      </>
    );
    if (!onSelectPly) return <span key={cell.index} className="inline-flex items-baseline">{inner}</span>;
    return (
      <button
        key={cell.index}
        onClick={() => onSelectPly(cell.index)}
        className={`inline-flex items-baseline rounded-sm px-0.5 transition-colors ${isActive ? 'bg-indigo-700/50' : 'hover:bg-zinc-800/60'}`}
      >
        {inner}
      </button>
    );
  };

  return (
    <div className={`${heightClass} overflow-y-auto ${className}`}>
      <div className="flex justify-end pb-0.5 sticky top-0">
        <MovesViewToggle view={view} onChange={setView} />
      </div>
      {view === 'inline' ? (
        <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm leading-6">
          {plies.map((ply, index) => renderInlinePly({ ply, index }))}
        </div>
      ) : (
        rows.map((r) => (
          <div key={r.num} className="flex items-start gap-2 py-0.5 border-b border-zinc-800/40 last:border-0 text-sm">
            <span className="font-mono text-zinc-600 w-7 shrink-0 text-right pt-px">{r.num}.</span>
            <div className="flex-1 min-w-0">{renderCell(r.w)}</div>
            <div className="flex-1 min-w-0">{renderCell(r.b)}</div>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
