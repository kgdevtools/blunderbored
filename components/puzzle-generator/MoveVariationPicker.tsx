'use client';
// Inline panel shown under a flagged move in puzzle mode: the engine's
// variation(s) from that position (bestLineUci, plus bestLineUci2 if the
// deep pass found a close second), rendered as a real numbered move list —
// no Avoid/Punish labeling here, just "here's what the engine would play."
// Selecting a row previews it on the shared board; the checkbox adds/removes
// it from the working draft set.

import { useMemo } from 'react';
import type { ReviewedMove } from '@/lib/analysis';
import { buildSolutionSans, numberedSolutionMoves } from '@/lib/puzzleSolution';

const DRAFT_MAX_PLIES = 6;

interface VariationRowProps {
  move: ReviewedMove;
  variantIndex: 0 | 1;
  line: string[];
  included: boolean;
  onToggleDraft: (move: ReviewedMove, variantIndex: 0 | 1, checked: boolean) => void;
  onPreview: (fen: string, lastMove: { from: string; to: string } | null) => void;
}

function VariationRow({ move, variantIndex, line, included, onToggleDraft, onPreview }: VariationRowProps) {
  const capped = useMemo(() => line.slice(0, DRAFT_MAX_PLIES), [line]);
  const { fens, sans } = useMemo(() => buildSolutionSans(move.fenBefore, capped), [move.fenBefore, capped]);
  const labels = useMemo(() => numberedSolutionMoves(move.fenBefore, sans), [move.fenBefore, sans]);

  const preview = () => {
    const applied = capped.slice(0, fens.length - 1);
    const lastUci = applied[applied.length - 1];
    onPreview(fens[fens.length - 1] ?? move.fenBefore, lastUci ? { from: lastUci.slice(0, 2), to: lastUci.slice(2, 4) } : null);
  };

  return (
    <div className={`rounded border p-2 space-y-1 ${included ? 'border-emerald-700 bg-emerald-950/20' : 'border-zinc-700 bg-zinc-900/60'}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => { onToggleDraft(move, variantIndex, e.target.checked); preview(); }}
          className="mt-0.5 shrink-0"
        />
        <button onClick={preview} className="flex-1 min-w-0 text-left">
          <span className="text-[10px] text-zinc-500 block mb-0.5">
            {variantIndex === 0 ? 'Best line' : 'Alternative'}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono text-xs text-zinc-200">
            {labels.map(({ label, i }) => <span key={i}>{label}</span>)}
          </span>
        </button>
      </div>
    </div>
  );
}

interface MoveVariationPickerProps {
  move: ReviewedMove;
  draftedKeys: Set<string>;
  onToggleDraft: (move: ReviewedMove, variantIndex: 0 | 1, checked: boolean) => void;
  onPreview: (fen: string, lastMove: { from: string; to: string } | null) => void;
}

export function MoveVariationPicker({ move, draftedKeys, onToggleDraft, onPreview }: MoveVariationPickerProps) {
  if (!move.bestLineUci?.length) {
    return <p className="mx-8 mb-1 text-xs text-zinc-500">No engine line stored for this move.</p>;
  }
  return (
    <div className="mx-1 mb-1.5 space-y-1">
      <VariationRow
        move={move}
        variantIndex={0}
        line={move.bestLineUci}
        included={draftedKeys.has(`${move.moveIndex}:0`)}
        onToggleDraft={onToggleDraft}
        onPreview={onPreview}
      />
      {move.bestLineUci2?.length ? (
        <VariationRow
          move={move}
          variantIndex={1}
          line={move.bestLineUci2}
          included={draftedKeys.has(`${move.moveIndex}:1`)}
          onToggleDraft={onToggleDraft}
          onPreview={onPreview}
        />
      ) : null}
    </div>
  );
}
