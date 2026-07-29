'use client';
import { useEffect, useMemo, useRef } from 'react';
import { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
import { scrollActiveIntoView } from '@/lib/scroll';
import { PUZZLE_WORTHY_QUALITIES } from '@/lib/puzzleSolution';
import { MoveVariationPicker } from './MoveVariationPicker';
import { MovesViewToggle, useMovesView } from '@/components/common/MovesViewToggle';

// Still used by Solve mode (components/puzzles/SolveSetMode.tsx) — every
// puzzle built by the picker below is an "avoid-blunder" ("what should have
// been played instead"), so this stays even though the picker itself never
// surfaces the Avoid/Punish distinction.
export const KIND_LABEL = { 'avoid-blunder': 'Avoid', 'punish-blunder': 'Punish' } as const;

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
  puzzleMode: boolean;
  expandedMoveIndex: number | null;
  onToggleExpand: (move: ReviewedMove) => void;
  draftedKeys: Set<string>;
  onToggleDraft: (move: ReviewedMove, variantIndex: 0 | 1, checked: boolean) => void;
  onPreview: (fen: string, lastMove: { from: string; to: string } | null) => void;
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

interface MoveHalfProps {
  move: ReviewedMove | undefined;
  isActive: boolean;
  isExpanded: boolean;
  puzzleMode: boolean;
  onClick: () => void;
}

function MoveHalf({ move, isActive, isExpanded, puzzleMode, onClick }: MoveHalfProps) {
  if (!move) return <div className="flex-1 min-w-0" />;
  const meta = QUALITY_META[move.quality];
  const flagged = puzzleMode && PUZZLE_WORTHY_QUALITIES.has(move.quality);
  return (
    <button
      onClick={onClick}
      style={flagged && !isActive ? { backgroundColor: `${meta.hex}2e` } : undefined}
      className={[
        'flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1.5 rounded text-left select-none transition-colors',
        isActive ? 'bg-blue-700 hover:bg-blue-600'
          : isExpanded ? 'ring-1 ring-inset ring-white/40'
          : flagged ? 'hover:brightness-125'
          : 'hover:bg-zinc-800 active:bg-zinc-700',
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
  moves, currentMoveIndex, onSelectMove, puzzleMode, expandedMoveIndex, onToggleExpand,
  draftedKeys, onToggleDraft, onPreview,
}: PuzzleMoveListProps) {
  const activePairRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useMovesView('puzzlegen', 'vertical');
  // The variation picker only exists in the paired/vertical layout — force
  // it while puzzle mode is on, restoring the user's preferred view after.
  const effectiveView = puzzleMode ? 'vertical' : view;
  const pairs = useMemo(() => groupMovePairs(moves), [moves]);

  useEffect(() => {
    scrollActiveIntoView(activePairRef.current);
  }, [currentMoveIndex, effectiveView]);

  if (moves.length === 0) {
    return <p className="text-zinc-500 text-xs px-1 py-2">Analyse a game to see its moves.</p>;
  }

  const handleHalfClick = (move: ReviewedMove | undefined) => {
    if (!move) return;
    if (puzzleMode && PUZZLE_WORTHY_QUALITIES.has(move.quality)) onToggleExpand(move);
    else onSelectMove(move.moveIndex);
  };

  // ── Inline view: flowing scoresheet (puzzle mode always uses the paired
  // view below instead, so this never needs to render highlights/pickers). ──
  if (effectiveView === 'inline') {
    return (
      <>
        <div className="flex justify-end pb-1">
          <MovesViewToggle view={view} onChange={setView} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-px gap-y-0.5 text-sm leading-6">
          {moves.map((m) => {
            const isActive = m.moveIndex === currentMoveIndex;
            const meta = QUALITY_META[m.quality];
            const isWhite = m.color === 'w';
            return (
              <span key={m.moveIndex} className="inline-flex flex-wrap items-baseline gap-px">
                {(isWhite || m.moveIndex === 0) && (
                  <span className="font-mono text-zinc-400">
                    {Math.floor(m.moveIndex / 2) + 1}{isWhite ? '.' : '...'}
                  </span>
                )}
                <button
                  ref={isActive ? (el: HTMLButtonElement | null) => { if (el) (activePairRef as { current: HTMLElement | null }).current = el; } : undefined}
                  onClick={() => onSelectMove(m.moveIndex)}
                  className={[
                    'font-mono rounded px-1 transition-colors select-none text-white hover:bg-zinc-600',
                    isActive ? 'bg-blue-600 font-semibold hover:bg-blue-500' : '',
                  ].join(' ')}
                >
                  {m.moveSan}
                  {meta.symbol && (
                    <span className={`font-bold ${isActive ? 'text-white' : meta.color}`}>{meta.symbol}</span>
                  )}
                </button>
                <span className="font-mono text-[10px] tabular-nums text-zinc-500 ml-0.5">{formatEval(m.evalAfter)}</span>
              </span>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-px">
      <div className="flex items-center justify-between gap-2 pb-1">
        {puzzleMode ? (
          <p className="text-xs text-zinc-500 px-1">
            Tap a highlighted move to see the engine&rsquo;s alternative and add it to your set.
          </p>
        ) : <span />}
        {!puzzleMode && <MovesViewToggle view={view} onChange={setView} />}
      </div>
      {pairs.map((pair) => {
        const whiteActive = pair.white?.moveIndex === currentMoveIndex;
        const blackActive = pair.black?.moveIndex === currentMoveIndex;
        const isPairActive = whiteActive || blackActive;
        const expandedMove = pair.white?.moveIndex === expandedMoveIndex ? pair.white
          : pair.black?.moveIndex === expandedMoveIndex ? pair.black
          : null;

        return (
          <div key={pair.key} ref={isPairActive ? activePairRef : undefined}>
            <div className="flex items-center gap-0.5 min-w-0">
              <span className="text-zinc-500 text-xs font-mono w-7 shrink-0 text-right tabular-nums pr-0.5">
                {pair.moveNum}.
              </span>
              <MoveHalf
                move={pair.white}
                isActive={whiteActive}
                isExpanded={pair.white?.moveIndex === expandedMoveIndex}
                puzzleMode={puzzleMode}
                onClick={() => handleHalfClick(pair.white)}
              />
              <MoveHalf
                move={pair.black}
                isActive={blackActive}
                isExpanded={pair.black?.moveIndex === expandedMoveIndex}
                puzzleMode={puzzleMode}
                onClick={() => handleHalfClick(pair.black)}
              />
            </div>
            {expandedMove && (
              <MoveVariationPicker
                move={expandedMove}
                draftedKeys={draftedKeys}
                onToggleDraft={onToggleDraft}
                onPreview={onPreview}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
