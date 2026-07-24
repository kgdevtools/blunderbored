'use client';
import { useEffect, useMemo, useRef } from 'react';
import { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
import { scrollActiveIntoView } from '@/lib/scroll';
import type { Puzzle } from '@/lib/db';

export const KIND_LABEL = { 'avoid-blunder': 'Avoid', 'punish-blunder': 'Punish' } as const;
const KIND_CLS = {
  'avoid-blunder': 'bg-red-900/50 text-red-300',
  'punish-blunder': 'bg-emerald-900/50 text-emerald-300',
} as const;

function formatEval(cp: number): string {
  if (cp >= 9900) return '+M';
  if (cp <= -9900) return '-M';
  const abs = (Math.abs(cp) / 100).toFixed(2);
  return cp >= 0 ? `+${abs}` : `-${abs}`;
}

interface PuzzleMoveListProps {
  moves: ReviewedMove[];
  currentMoveIndex: number;
  onSelectMove: (index: number) => void;
  puzzlesByMoveIndex: Map<number, Puzzle[]>;
  selectedPuzzleId: string | null;
  onSelectPuzzle: (puzzle: Puzzle) => void;
}

interface MovePair {
  key: number;
  moveNum: number;
  white?: ReviewedMove;
  black?: ReviewedMove;
}

function groupMovePairs(moves: ReviewedMove[]): MovePair[] {
  const pairMap = new Map<number, MovePair>();
  for (const move of moves) {
    const pairKey = Math.floor(move.moveIndex / 2);
    if (!pairMap.has(pairKey)) pairMap.set(pairKey, { key: pairKey, moveNum: pairKey + 1 });
    const pair = pairMap.get(pairKey)!;
    if (move.color === 'w') pair.white = move;
    else pair.black = move;
  }
  return [...pairMap.values()].sort((a, b) => a.key - b.key);
}

function PuzzleBadges({
  puzzles, selectedPuzzleId, onSelectPuzzle,
}: {
  puzzles: Puzzle[] | undefined;
  selectedPuzzleId: string | null;
  onSelectPuzzle: (puzzle: Puzzle) => void;
}) {
  if (!puzzles || puzzles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 pl-8 pr-2 pb-1">
      {puzzles.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelectPuzzle(p)}
          className={[
            'text-[10px] px-1.5 py-0.5 rounded font-mono',
            KIND_CLS[p.kind],
            selectedPuzzleId === p.id ? 'ring-1 ring-white/70' : '',
          ].join(' ')}
          title={`${p.severity} · ${p.winPctLoss.toFixed(1)}% wp loss`}
        >
          {KIND_LABEL[p.kind]}
        </button>
      ))}
    </div>
  );
}

interface MoveHalfProps {
  move: ReviewedMove | undefined;
  isActive: boolean;
  onClick: () => void;
}

function MoveHalf({ move, isActive, onClick }: MoveHalfProps) {
  if (!move) return <div className="flex-1 min-w-0" />;
  const meta = QUALITY_META[move.quality];
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1.5 rounded text-left select-none transition-colors',
        isActive ? 'bg-blue-700 hover:bg-blue-600' : 'hover:bg-zinc-800 active:bg-zinc-700',
      ].join(' ')}
    >
      <span className={`font-mono text-sm shrink-0 ${isActive ? 'text-white font-semibold' : 'text-zinc-100'}`}>
        {move.moveSan}
      </span>
      {meta.symbol && (
        <span className={`font-mono text-xs font-bold shrink-0 ${isActive ? 'text-white/80' : meta.color}`}>
          {meta.symbol}
        </span>
      )}
      <span className={`text-xs font-mono tabular-nums ml-auto shrink-0 ${isActive ? 'text-blue-200' : 'text-zinc-500'}`}>
        {formatEval(move.evalAfter)}
      </span>
    </button>
  );
}

export function PuzzleMoveList({
  moves, currentMoveIndex, onSelectMove, puzzlesByMoveIndex, selectedPuzzleId, onSelectPuzzle,
}: PuzzleMoveListProps) {
  const activePairRef = useRef<HTMLDivElement>(null);
  const pairs = useMemo(() => groupMovePairs(moves), [moves]);

  useEffect(() => {
    scrollActiveIntoView(activePairRef.current);
  }, [currentMoveIndex]);

  if (moves.length === 0) {
    return <p className="text-zinc-500 text-xs px-1 py-2">Analyse a game to see its moves.</p>;
  }

  return (
    <div className="space-y-px">
      {pairs.map((pair) => {
        const whiteActive = pair.white?.moveIndex === currentMoveIndex;
        const blackActive = pair.black?.moveIndex === currentMoveIndex;
        const isPairActive = whiteActive || blackActive;

        return (
          <div key={pair.key} ref={isPairActive ? activePairRef : undefined}>
            <div className="flex items-center gap-0.5 min-w-0">
              <span className="text-zinc-500 text-xs font-mono w-7 shrink-0 text-right tabular-nums pr-0.5">
                {pair.moveNum}.
              </span>
              <MoveHalf
                move={pair.white}
                isActive={whiteActive}
                onClick={() => pair.white && onSelectMove(pair.white.moveIndex)}
              />
              <MoveHalf
                move={pair.black}
                isActive={blackActive}
                onClick={() => pair.black && onSelectMove(pair.black.moveIndex)}
              />
            </div>
            {pair.white && (
              <PuzzleBadges
                puzzles={puzzlesByMoveIndex.get(pair.white.moveIndex)}
                selectedPuzzleId={selectedPuzzleId}
                onSelectPuzzle={onSelectPuzzle}
              />
            )}
            {pair.black && (
              <PuzzleBadges
                puzzles={puzzlesByMoveIndex.get(pair.black.moveIndex)}
                selectedPuzzleId={selectedPuzzleId}
                onSelectPuzzle={onSelectPuzzle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
