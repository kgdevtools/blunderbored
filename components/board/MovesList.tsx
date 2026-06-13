'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { GameNode, MoveListToken, NodeAnnotation, NodeMeta, AnnoSource } from '@/lib/gameTree';
import { formatSeconds } from '@/lib/clock';
import { scrollActiveIntoView } from '@/lib/scroll';
import { RefLinker } from './RefLinker';
import { SavePositionDialog } from '@/components/blunderable/SavedPositions';

// Comment text colour by provenance, so imported / manual / reviewer notes are
// visually distinct where they sit side by side on a move.
const SOURCE_STYLE: Record<AnnoSource, string> = {
  pgn: 'text-zinc-400 italic',
  manual: 'text-amber-300',
  reviewer: 'text-sky-300',
};

interface MovesListProps {
  tokens: MoveListToken[];
  current: GameNode;
  onSelect: (node: GameNode) => void;
  onDeleteMove: (node: GameNode) => void;
  onDeleteAfter: (node: GameNode) => void;
  comments?: Map<string, NodeAnnotation[]>;
  meta?: Map<string, NodeMeta>;
  onSetComment?: (nodeId: string, text: string) => void;
  nags?: Map<string, number[]>;
  onSetNags?: (nodeId: string, codes: number[]) => void;
  // The saved library game id, if this game is in the library. Refs need it as
  // their source; when null the ref action is disabled.
  gameId?: string | null;
}

// Standard PGN NAGs, ordered best → worst for the picker.
const NAG_OPTIONS: { code: number; glyph: string; color: string }[] = [
  { code: 3, glyph: '!!', color: 'text-green-400' },
  { code: 1, glyph: '!',  color: 'text-green-400' },
  { code: 5, glyph: '!?', color: 'text-blue-400' },
  { code: 6, glyph: '?!', color: 'text-amber-400' },
  { code: 2, glyph: '?',  color: 'text-red-400' },
  { code: 4, glyph: '??', color: 'text-red-400' },
];
const NAG_BY_CODE = new Map(NAG_OPTIONS.map((n) => [n.code, n]));

function getMoveNumber(node: GameNode): number {
  return parseInt(node.parent!.fen.split(' ')[5], 10);
}

function moveLabel(node: GameNode): string {
  const num = getMoveNumber(node);
  return `${num}${node.move!.color === 'b' ? '...' : '.'} ${node.move!.san}`;
}

interface CtxMenu {
  x: number;
  y: number;
  node: GameNode;
}

// The user-editable ('manual') comment on a node, if any — what the inline
// editor binds to. Imported and reviewer comments are read-only here.
function manualText(annos: NodeAnnotation[] | undefined): string {
  return annos?.find((a) => a.source === 'manual')?.text ?? '';
}

export function MovesList({ tokens, current, onSelect, onDeleteMove, onDeleteAfter, comments, meta, onSetComment, nags, onSetNags, gameId }: MovesListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [refNode, setRefNode] = useState<GameNode | null>(null);
  const [savePosNode, setSavePosNode] = useState<GameNode | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toggle a NAG: picking the one already set clears it.
  const handleToggleNag = (node: GameNode, code: number) => {
    const current = nags?.get(node.id) ?? [];
    onSetNags?.(node.id, current.includes(code) ? [] : [code]);
    setCtxMenu(null);
  };

  useEffect(() => {
    scrollActiveIntoView(activeRef.current);
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
          const annos = comments?.get(node.id) ?? [];
          const hasComment = annos.length > 0;
          const clk = meta?.get(node.id)?.clk;
          const isEditing = editingNodeId === node.id;
          const nagInfo = NAG_BY_CODE.get(nags?.get(node.id)?.[0] ?? -1);

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
                    // A commented move is shaded rather than dotted; active (blue) wins.
                    hasComment && !isActive ? 'bg-amber-500/15' : '',
                    isActive ? 'bg-blue-600 text-white font-semibold hover:bg-blue-500' : '',
                  ].join(' ')}
                >
                  {node.move!.san}
                  {nagInfo && (
                    <span className={`font-bold ${isActive ? 'text-white' : nagInfo.color}`}>{nagInfo.glyph}</span>
                  )}
                </button>
                {/* Clock remaining after this move, when the PGN carried [%clk]. */}
                {clk != null && (
                  <span className="font-mono text-[10px] text-zinc-500 tabular-nums ml-0.5">{formatSeconds(clk)}</span>
                )}
              </span>

              {/* Comment display — one span per source, colour-coded by provenance. */}
              {hasComment && !isEditing && annos.map((a, ai) => (
                <span
                  key={ai}
                  className={`mx-1 text-xs tracking-tightest leading-tight font-[family-name:var(--font-jetbrains-mono)] ${SOURCE_STYLE[a.source]}`}
                >
                  {a.text}
                </span>
              ))}

              {/* Inline comment editor */}
              {isEditing && (
                <div className="w-full px-1 pb-1">
                  <textarea
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    className="w-full text-xs px-2 py-1.5 rounded bg-zinc-700 border border-zinc-600 text-zinc-100 resize-none focus:outline-none focus:border-blue-500"
                    rows={2}
                    defaultValue={manualText(annos)}
                    onBlur={(e) => handleSaveComment(node.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveComment(node.id, (e.target as HTMLTextAreaElement).value);
                      }
                      if (e.key === 'Escape') handleSaveComment(node.id, manualText(annos));
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
          {onSetNags && (
            <>
              <div className="flex items-center gap-0.5 px-2 py-1.5">
                {NAG_OPTIONS.map((n) => {
                  const isSet = (nags?.get(ctxMenu.node.id) ?? []).includes(n.code);
                  return (
                    <button
                      key={n.code}
                      onClick={() => handleToggleNag(ctxMenu.node, n.code)}
                      title={`Annotate ${n.glyph}`}
                      className={[
                        'flex-1 rounded px-1 py-0.5 font-mono font-bold text-sm hover:bg-zinc-700',
                        isSet ? `bg-zinc-700 ${n.color}` : n.color,
                      ].join(' ')}
                    >
                      {n.glyph}
                    </button>
                  );
                })}
              </div>
              <div className="my-1 border-t border-zinc-700" />
            </>
          )}
          {onSetComment && (
            <>
              <button
                className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
                onClick={() => handleAddComment(ctxMenu.node)}
              >
                {manualText(comments?.get(ctxMenu.node.id)) ? 'Edit Comment' : 'Add Comment'}
              </button>
              {manualText(comments?.get(ctxMenu.node.id)) && (
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
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!gameId}
            title={gameId ? undefined : 'Save this game to the library first'}
            onClick={() => { setRefNode(ctxMenu.node); setCtxMenu(null); }}
          >
            Link to game / concept…
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={() => { setSavePosNode(ctxMenu.node); setCtxMenu(null); }}
          >
            Save Position to Practice
          </button>
          <div className="my-1 border-t border-zinc-700" />
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

      {refNode && gameId && (
        <RefLinker
          gameId={gameId}
          sourceNodeId={refNode.id}
          moveLabel={moveLabel(refNode)}
          onClose={() => setRefNode(null)}
        />
      )}

      {savePosNode && (
        <SavePositionDialog
          input={{ fen: savePosNode.fen, side: savePosNode.fen.split(' ')[1] === 'b' ? 'b' : 'w', source: 'board' }}
          onClose={() => setSavePosNode(null)}
        />
      )}
    </>
  );
}
