'use client';
// Puzzle Set tab: the puzzles WITHIN the currently open set (browsing/
// creating sets themselves lives in the Workouts tab now) — toolbar (+ New /
// back to Workouts) plus the compact list of puzzles already in it: mini
// board + description + theme pills + solution preview (real SAN, not UCI).
// Clicking a row loads that puzzle onto the board (same as its gear icon);
// the gear/delete/reorder buttons stop propagation so they don't also
// trigger the row click. Importing a position/game (FEN, PGN, Lichess, file)
// lives in the Edit tab now, since "+ New" already lands you there.

import { useState } from 'react';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Puzzle } from '@/lib/db';
import { solutionLine, buildSolutionSans, numberedSolutionMoves } from '@/lib/puzzleSolution';

interface PuzzleSetTabProps {
  openSetId: string | null;
  openSetName: string;
  puzzlesInSet: Puzzle[];
  onGoToWorkouts: () => void;
  onNewPuzzle: () => void;
  onEditPuzzle: (puzzle: Puzzle) => void;
  onDeletePuzzle: (puzzleId: string) => void;
  onReorderPuzzle: (puzzleId: string, direction: 'up' | 'down') => void;
}

const MINI_BOARD_PX = 64;

function MiniBoard({ fen }: { fen: string }) {
  return (
    <div className="rounded-sm overflow-hidden border border-zinc-700 shrink-0" style={{ width: MINI_BOARD_PX, height: MINI_BOARD_PX }}>
      <Chessboard position={fen} arePiecesDraggable={false} areArrowsAllowed={false} boardWidth={MINI_BOARD_PX} />
    </div>
  );
}

// Numbered SAN preview ("36. Qxf7 dxc6 37. Qf3+"), not raw UCI.
function sanPreview(p: Puzzle): string {
  const uci = solutionLine(p);
  const { sans } = buildSolutionSans(p.fen, uci);
  return numberedSolutionMoves(p.fen, sans).map(({ label }) => label).join(' ');
}

export function PuzzleSetTab({
  openSetId, openSetName, puzzlesInSet,
  onGoToWorkouts, onNewPuzzle, onEditPuzzle, onDeletePuzzle, onReorderPuzzle,
}: PuzzleSetTabProps) {
  const [confirmingPuzzleId, setConfirmingPuzzleId] = useState<string | null>(null);

  if (!openSetId) {
    return (
      <div className="text-center py-6 px-2">
        <p className="text-xs text-zinc-500 mb-2">No set open yet.</p>
        <button onClick={onGoToWorkouts} className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-medium transition-colors">
          Go to Workouts →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={onNewPuzzle}
          title="Start a new puzzle (opens the Edit tab)"
          className="flex items-center gap-1 px-2.5 h-8 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0"
        >
          ＋ New
        </button>
        <button onClick={onGoToWorkouts} title="Back to the Workouts list" className="ml-auto px-2.5 h-8 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 text-xs shrink-0">
          ◁ Workouts
        </button>
      </div>

      <p className="text-xs text-zinc-400 px-0.5 truncate">
        Puzzle set: <b className="text-zinc-100">{openSetName}</b> · {puzzlesInSet.length} puzzle{puzzlesInSet.length === 1 ? '' : 's'}
      </p>

      {puzzlesInSet.length === 0 ? (
        <p className="text-xs text-zinc-500 px-1">No puzzles in this set yet — hit ＋ New to build one.</p>
      ) : (
        <div className="flex flex-col min-w-0">
          {puzzlesInSet.map((p, i) => (
            <div
              key={p.id}
              onClick={() => onEditPuzzle(p)}
              className="flex items-center gap-2 py-1.5 px-1 border-b border-zinc-800 last:border-none min-w-0 max-w-full overflow-hidden cursor-pointer hover:bg-zinc-800/60 rounded transition-colors"
            >
              <div className="flex flex-col shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onReorderPuzzle(p.id, 'up')}
                  disabled={i === 0}
                  title="Move up"
                  className="w-4 h-3.5 grid place-items-center text-zinc-500 hover:text-zinc-100 disabled:opacity-20 disabled:cursor-not-allowed text-[9px] leading-none"
                >
                  ▲
                </button>
                <button
                  onClick={() => onReorderPuzzle(p.id, 'down')}
                  disabled={i === puzzlesInSet.length - 1}
                  title="Move down"
                  className="w-4 h-3.5 grid place-items-center text-zinc-500 hover:text-zinc-100 disabled:opacity-20 disabled:cursor-not-allowed text-[9px] leading-none"
                >
                  ▼
                </button>
              </div>
              <MiniBoard fen={p.fen} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-100 font-semibold truncate">{p.note || 'Untitled puzzle'}</p>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  {(p.themes ?? []).map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-px rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">{t}</span>
                  ))}
                </div>
                <p className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">{sanPreview(p)}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onEditPuzzle(p); }} title="Edit" className="shrink-0 w-6 h-6 grid place-items-center rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700">⚙</button>
              {confirmingPuzzleId === p.id ? (
                <span onClick={(e) => e.stopPropagation()} className="shrink-0 inline-flex items-center gap-1 text-[10px]">
                  <button onClick={() => { onDeletePuzzle(p.id); setConfirmingPuzzleId(null); }} className="text-red-400 hover:text-red-300 font-medium">Confirm</button>
                  <button onClick={() => setConfirmingPuzzleId(null)} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
                </span>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); setConfirmingPuzzleId(p.id); }} title="Delete" className="shrink-0 w-6 h-6 grid place-items-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800">🗑</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
