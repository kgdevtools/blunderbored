'use client';
// Moves tab: the live line/tree for the puzzle currently being authored.
// Just MovesList (same component /board uses) wired to useBoardGame's tree —
// variations/sub-variations nest exactly the way they already do on /board.
// Sidelines are reference-only (see CreatePuzzleShell's save logic): only the
// main line (getMainLine(root)) is ever graded.

import { MovesList } from '@/components/board/MovesList';
import type { useBoardGame } from '@/hooks/useBoardGame';

interface PuzzleMovesTabProps {
  game: ReturnType<typeof useBoardGame>;
  editingLabel: string;
}

export function PuzzleMovesTab({ game, editingLabel }: PuzzleMovesTabProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800 rounded px-2.5 py-1.5">
        <span>💡</span>
        <span>Editing: <b className="text-zinc-100 font-semibold">{editingLabel}</b></span>
      </div>
      <MovesList
        tokens={game.tokens}
        current={game.current}
        onSelect={game.goTo}
        onDeleteMove={game.deleteMove}
        onDeleteAfter={game.deleteAfter}
      />
      <p className="text-[10px] text-zinc-600">
        Tap a move to jump the board there · play a new move mid-line to branch a sub-variation
        (kept for reference — only the main line is graded when solving).
      </p>
    </div>
  );
}
