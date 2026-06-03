'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META } from '@/lib/accuracy';
import { scrollActiveIntoView } from '@/lib/scroll';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEval(cp: number): string {
  if (cp >= 9900)  return '+M';
  if (cp <= -9900) return '-M';
  const abs = (Math.abs(cp) / 100).toFixed(2);
  return cp >= 0 ? `+${abs}` : `-${abs}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CtxMenu { x: number; y: number; moveIndex: number; }

interface ReviewMoveListProps {
  moves: ReviewedMove[];
  currentMoveIndex: number;
  onSelectMove: (index: number) => void;
  comments: Map<number, string>;
  onSetComment: (moveIndex: number, text: string) => void;
}

interface MovePair {
  key: number;
  moveNum: number;
  white?: ReviewedMove;
  black?: ReviewedMove;
}

// ── Grouping ──────────────────────────────────────────────────────────────────

function groupMovePairs(moves: ReviewedMove[]): MovePair[] {
  const pairMap = new Map<number, MovePair>();
  for (const move of moves) {
    const pairKey = Math.floor(move.moveIndex / 2);
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, { key: pairKey, moveNum: pairKey + 1 });
    }
    const pair = pairMap.get(pairKey)!;
    if (move.color === 'w') pair.white = move;
    else pair.black = move;
  }
  return [...pairMap.values()].sort((a, b) => a.key - b.key);
}

// ── Comment editor ────────────────────────────────────────────────────────────

function CommentEditor({ comment, onSave }: { comment: string | undefined; onSave: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="px-2 pb-1.5">
      <textarea
        ref={ref}
        className="w-full text-xs px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-zinc-100 resize-none focus:outline-none focus:border-blue-500"
        rows={2}
        defaultValue={comment ?? ''}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave((e.target as HTMLTextAreaElement).value); }
          if (e.key === 'Escape') onSave(comment ?? '');
        }}
        placeholder="Add a comment…"
      />
      <p className="text-[10px] text-zinc-600 mt-0.5 pl-0.5">Enter to save · Esc to cancel</p>
    </div>
  );
}

// ── Half-move cell ────────────────────────────────────────────────────────────

interface MoveHalfProps {
  move: ReviewedMove | undefined;
  isActive: boolean;
  onClick: () => void;
  onCtxMenu: (x: number, y: number) => void;
}

function MoveHalf({ move, isActive, onClick, onCtxMenu }: MoveHalfProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!move) return <div className="flex-1 min-w-0" />;

  const meta = QUALITY_META[move.quality];

  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onCtxMenu(e.clientX, e.clientY); }}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        longPressTimer.current = setTimeout(() => { longPressTimer.current = null; onCtxMenu(touch.clientX, touch.clientY); }, 500);
      }}
      onTouchEnd={clearLongPress}
      onTouchMove={clearLongPress}
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

// ── Main list ─────────────────────────────────────────────────────────────────

export function ReviewMoveList({ moves, currentMoveIndex, onSelectMove, comments, onSetComment }: ReviewMoveListProps) {
  const activePairRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [editingComment, setEditingComment] = useState<number | null>(null);

  const pairs = useMemo(() => groupMovePairs(moves), [moves]);

  useEffect(() => {
    scrollActiveIntoView(activePairRef.current);
  }, [currentMoveIndex]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('touchstart', close, { passive: true });
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('touchstart', close); };
  }, [!!ctxMenu]);

  if (moves.length === 0) {
    return <p className="text-zinc-500 text-xs px-1 py-2">Load a PGN to review the game.</p>;
  }

  const handleSaveComment = (moveIndex: number, text: string) => {
    onSetComment(moveIndex, text);
    setEditingComment(null);
  };

  return (
    <>
      <div className="space-y-px">
        {pairs.map((pair) => {
          const whiteActive = pair.white?.moveIndex === currentMoveIndex;
          const blackActive = pair.black?.moveIndex === currentMoveIndex;
          const isPairActive = whiteActive || blackActive;
          const activeMove = whiteActive ? pair.white : blackActive ? pair.black : undefined;

          const whiteComment = pair.white ? comments.get(pair.white.moveIndex) : undefined;
          const blackComment = pair.black ? comments.get(pair.black.moveIndex) : undefined;
          const editingWhite = pair.white !== undefined && editingComment === pair.white.moveIndex;
          const editingBlack = pair.black !== undefined && editingComment === pair.black.moveIndex;

          return (
            <div key={pair.key} ref={isPairActive ? activePairRef : undefined}>
              {/* Paired move row */}
              <div className="flex items-center gap-0.5 min-w-0">
                <span className="text-zinc-500 text-xs font-mono w-7 shrink-0 text-right tabular-nums pr-0.5">
                  {pair.moveNum}.
                </span>
                <MoveHalf
                  move={pair.white}
                  isActive={whiteActive}
                  onClick={() => pair.white && onSelectMove(pair.white.moveIndex)}
                  onCtxMenu={(x, y) => pair.white && setCtxMenu({ x, y, moveIndex: pair.white.moveIndex })}
                />
                <MoveHalf
                  move={pair.black}
                  isActive={blackActive}
                  onClick={() => pair.black && onSelectMove(pair.black.moveIndex)}
                  onCtxMenu={(x, y) => pair.black && setCtxMenu({ x, y, moveIndex: pair.black.moveIndex })}
                />
              </div>

              {/* Expanded detail for the active half */}
              {isPairActive && activeMove && (
                <div className="pl-8 pr-2 pb-1 space-y-0.5">
                  {activeMove.bestMoveSan && (
                    <div className="flex items-baseline gap-1 text-xs py-0.5">
                      <span className="text-zinc-500 shrink-0">Best:</span>
                      <span className="font-mono text-zinc-300">{activeMove.bestMoveSan}</span>
                      <span className="text-zinc-600 tabular-nums">({formatEval(activeMove.evalBefore)})</span>
                    </div>
                  )}
                </div>
              )}

              {/* Per-half comments */}
              {whiteComment && !editingWhite && (
                <div className="pl-8 pr-2 mb-0.5 text-xs text-zinc-400 tracking-tightest leading-tight font-[family-name:var(--font-jetbrains-mono)]">
                  {whiteComment}
                </div>
              )}
              {editingWhite && (
                <CommentEditor comment={whiteComment} onSave={(t) => pair.white && handleSaveComment(pair.white.moveIndex, t)} />
              )}
              {blackComment && !editingBlack && (
                <div className="pl-8 pr-2 mb-0.5 text-xs text-zinc-400 tracking-tightest leading-tight font-[family-name:var(--font-jetbrains-mono)]">
                  {blackComment}
                </div>
              )}
              {editingBlack && (
                <CommentEditor comment={blackComment} onSave={(t) => pair.black && handleSaveComment(pair.black.moveIndex, t)} />
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[180px] text-sm"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 200), top: Math.min(ctxMenu.y, window.innerHeight - 80) }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={() => { setEditingComment(ctxMenu.moveIndex); setCtxMenu(null); }}
          >
            {comments.get(ctxMenu.moveIndex) ? 'Edit Comment' : 'Add Comment'}
          </button>
          {comments.get(ctxMenu.moveIndex) && (
            <button
              className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400"
              onClick={() => { onSetComment(ctxMenu.moveIndex, ''); setCtxMenu(null); }}
            >
              Remove Comment
            </button>
          )}
        </div>
      )}
    </>
  );
}
