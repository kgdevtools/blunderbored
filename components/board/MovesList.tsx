'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { GameNode, MoveListToken } from '@/lib/gameTree';

interface MovesListProps {
  tokens: MoveListToken[];
  current: GameNode;
  onSelect: (node: GameNode) => void;
  onDeleteMove: (node: GameNode) => void;
  onDeleteAfter: (node: GameNode) => void;
  comments?: Map<string, string>;
  onSetComment?: (nodeId: string, text: string) => void;
}

function getMoveNumber(node: GameNode): number {
  return parseInt(node.parent!.fen.split(' ')[5], 10);
}

interface CtxMenu {
  x: number;
  y: number;
  node: GameNode;
}

export function MovesList({ tokens, current, onSelect, onDeleteMove, onDeleteAfter, comments, onSetComment }: MovesListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current.id]);

  // Close context menu on outside click / touch
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('touchstart', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('touchstart', close);
    };
  }, [!!ctxMenu]);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleAddComment = (node: GameNode) => {
    setCtxMenu(null);
    setEditingNodeId(node.id);
  };

  const handleSaveComment = (nodeId: string, text: string) => {
    onSetComment?.(nodeId, text);
    setEditingNodeId(null);
  };

  if (tokens.length === 0) {
    return <p className="text-zinc-500 text-xs px-1">No moves yet.</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-px gap-y-0.5 text-sm leading-6 overflow-y-auto">
        {tokens.map((token, i) => {
          if (token.kind === 'var-open') {
            return <span key={`vo-${i}`} className="text-zinc-500 text-xs">(</span>;
          }
          if (token.kind === 'var-close') {
            return <span key={`vc-${i}`} className="text-zinc-500 text-xs">)</span>;
          }

          if (token.kind !== 'move') return null;
          const { node, showMoveNumber, variationDepth } = token;
          const isActive = node.id === current.id;
          const isBlack = node.move!.color === 'b';
          const moveNum = getMoveNumber(node);
          const isVariation = variationDepth > 0;
          const comment = comments?.get(node.id);
          const isEditing = editingNodeId === node.id;

          return (
            <Fragment key={node.id}>
              <span className="inline-flex items-baseline gap-px">
                {showMoveNumber && (
                  <span className={`font-mono ${isVariation ? 'text-zinc-500 text-xs' : 'text-zinc-400'}`}>
                    {moveNum}{isBlack ? '...' : '.'}
                  </span>
                )}
                <button
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSelect(node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, node });
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    longPressTimer.current = setTimeout(() => {
                      longPressTimer.current = null;
                      setCtxMenu({ x: touch.clientX, y: touch.clientY, node });
                    }, 500);
                  }}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                  className={[
                    'font-mono rounded px-1 transition-colors select-none',
                    isVariation ? 'text-xs text-zinc-400 hover:bg-zinc-700' : 'text-white hover:bg-zinc-600',
                    isActive ? 'bg-blue-600 text-white font-semibold hover:bg-blue-500' : '',
                  ].join(' ')}
                >
                  {node.move!.san}
                  {comment && !isEditing && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5 align-middle" />
                  )}
                </button>
              </span>

              {/* Comment display */}
              {comment && !isEditing && (
                <span className="mx-0.5 px-1.5 py-0.5 rounded bg-zinc-800 border-l-2 border-zinc-600 text-xs text-zinc-400 italic">
                  {comment}
                </span>
              )}

              {/* Inline comment editor */}
              {isEditing && (
                <div className="w-full px-1 pb-1">
                  <textarea
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    className="w-full text-xs px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-zinc-100 resize-none focus:outline-none focus:border-blue-500"
                    rows={2}
                    defaultValue={comment ?? ''}
                    onBlur={(e) => handleSaveComment(node.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveComment(node.id, (e.target as HTMLTextAreaElement).value);
                      }
                      if (e.key === 'Escape') handleSaveComment(node.id, comment ?? '');
                    }}
                    placeholder="Add a comment…"
                  />
                  <p className="text-[10px] text-zinc-600 mt-0.5 pl-0.5">Enter to save · Esc to cancel</p>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[190px] text-sm"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 200), top: Math.min(ctxMenu.y, window.innerHeight - 140) }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {onSetComment && (
            <>
              <button
                className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
                onClick={() => handleAddComment(ctxMenu.node)}
              >
                {comments?.get(ctxMenu.node.id) ? 'Edit Comment' : 'Add Comment'}
              </button>
              {comments?.get(ctxMenu.node.id) && (
                <button
                  className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400"
                  onClick={() => { onSetComment(ctxMenu.node.id, ''); setCtxMenu(null); }}
                >
                  Remove Comment
                </button>
              )}
              <div className="my-1 border-t border-zinc-700" />
            </>
          )}
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400"
            onClick={() => { onDeleteMove(ctxMenu.node); setCtxMenu(null); }}
          >
            Delete Move
          </button>
          <div className="my-1 border-t border-zinc-700" />
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={ctxMenu.node.children.length === 0}
            onClick={() => { onDeleteAfter(ctxMenu.node); setCtxMenu(null); }}
          >
            Delete All Moves After
          </button>
        </div>
      )}
    </>
  );
}
