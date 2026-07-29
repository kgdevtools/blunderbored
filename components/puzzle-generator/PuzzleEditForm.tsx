'use client';
// Single-puzzle editor used inside PuzzleBatchModal's tabs: title/note fields
// plus the solution as a real numbered move list — tapping a move trims the
// line there and previews that exact position on the shared board.

import { useMemo } from 'react';
import type { Puzzle } from '@/lib/db';
import { solutionLine, buildSolutionSans, numberedSolutionMoves } from '@/lib/puzzleSolution';

interface PuzzleEditFormProps {
  puzzle: Puzzle; // original draft — fen + full (already-capped-to-6) solutionLineUci
  title: string;
  note: string;
  cutAt: number;
  onTitleChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onCutAt: (i: number) => void;
  onPreview: (fen: string, lastMove: { from: string; to: string } | null) => void;
}

const inputCls =
  'w-full px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500';

export function PuzzleEditForm({
  puzzle, title, note, cutAt, onTitleChange, onNoteChange, onCutAt, onPreview,
}: PuzzleEditFormProps) {
  const line = useMemo(() => solutionLine(puzzle), [puzzle]);
  const { fens, sans } = useMemo(() => buildSolutionSans(puzzle.fen, line), [puzzle.fen, line]);
  const labels = useMemo(() => numberedSolutionMoves(puzzle.fen, sans), [puzzle.fen, sans]);

  const handleMoveClick = (i: number) => {
    onCutAt(i + 1);
    const uci = line[i];
    onPreview(fens[i + 1] ?? puzzle.fen, uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null);
  };

  return (
    <div className="space-y-2.5">
      <div>
        <label className="text-xs text-zinc-400 mb-0.5 block">Title</label>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Optional"
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-xs text-zinc-400 mb-0.5 block">Description</label>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Optional"
          rows={2}
          className={`${inputCls} resize-none`}
        />
      </div>
      <div>
        <p className="text-xs text-zinc-400 mb-1">Solution — tap a move to trim the line there.</p>
        <div className="flex flex-wrap gap-x-1 gap-y-1 font-mono text-xs">
          {labels.map(({ label, i }) => (
            <button
              key={i}
              onClick={() => handleMoveClick(i)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                i + 1 <= cutAt ? 'text-zinc-100 bg-zinc-700 hover:bg-zinc-600' : 'text-zinc-600 line-through hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
