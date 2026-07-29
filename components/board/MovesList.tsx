'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { GameNode, MoveListToken, NodeAnnotation, NodeMeta, AnnoSource } from '@/lib/gameTree';
import { formatSeconds } from '@/lib/clock';
import { scrollActiveIntoView } from '@/lib/scroll';
import { NAG_OPTIONS, NAG_BY_CODE } from '@/lib/nags';
import { classifyTimeSpent, TIME_BAND_META } from '@/lib/timeReview';
import type { GameFormat } from '@/lib/gameMeta';
import { RefLinker } from './RefLinker';
import { SavePositionDialog } from '@/components/blunderable/SavedPositions';
import { MovesViewToggle, useMovesView } from '@/components/common/MovesViewToggle';

// Time spent on `node`'s move = the same side's previous clock reading (two
// plies back, since colors alternate) minus this one, plus increment. Walks
// the node chain directly (not a flat main-line array) so it works for
// variation moves too, once those carry their own [%clk] data.
function timeSpentFor(node: GameNode, meta: Map<string, NodeMeta> | undefined, increment: number): number | null {
  const clk = meta?.get(node.id)?.clk;
  if (clk == null) return null;
  const prevNode = node.parent?.parent;
  const prevClk = prevNode ? meta?.get(prevNode.id)?.clk : undefined;
  if (prevClk == null) return null;
  return Math.max(0, prevClk - clk + increment);
}

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
  // Time reviewer — scales "time spent" bands to the game's time control.
  timeFormat?: GameFormat;
  timeIncrement?: number;
}

// Colour + compact label for a raw PGN [%eval] token ("+0.24", "-1.13", "#3",
// "#-2"). Always White-POV per the PGN spec, regardless of whose move it is.
function evalTokenColor(raw: string): string {
  if (raw.startsWith('#')) return raw.slice(1).startsWith('-') ? 'text-red-400' : 'text-emerald-400';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 'text-zinc-500';
  if (n >= 1.5) return 'text-emerald-400';
  if (n <= -1.5) return 'text-red-400';
  if (n >= 0.3) return 'text-emerald-300/70';
  if (n <= -0.3) return 'text-red-300/70';
  return 'text-zinc-500';
}
function evalTokenLabel(raw: string): string {
  if (raw.startsWith('#')) return `M${raw.slice(1)}`;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

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

// ── Vertical grouping ─────────────────────────────────────────────────────────
// One row per full move of the MAINLINE; any variation blocks that appear
// after a half-move trail the row as indented inline-flow groups.
interface VerticalRow {
  key: string;
  num: number;
  white?: Extract<MoveListToken, { kind: 'move' }>;
  black?: Extract<MoveListToken, { kind: 'move' }>;
  trail: MoveListToken[][];
}

function buildVerticalRows(tokens: MoveListToken[]): VerticalRow[] {
  const rows: VerticalRow[] = [];
  let depth = 0;
  let group: MoveListToken[] | null = null;

  const attachGroup = (g: MoveListToken[]) => {
    const row = rows[rows.length - 1];
    if (row) row.trail.push(g);
  };

  for (const token of tokens) {
    if (token.kind === 'var-open') {
      depth++;
      if (depth === 1) group = [token];
      else group?.push(token);
      continue;
    }
    if (token.kind === 'var-close') {
      group?.push(token);
      depth--;
      if (depth === 0 && group) { attachGroup(group); group = null; }
      continue;
    }
    if (token.kind !== 'move') continue;
    if (depth > 0) { group?.push(token); continue; }

    const color = token.node.move!.color;
    const num = getMoveNumber(token.node);
    const last = rows[rows.length - 1];
    if (color === 'w' || !last || last.black || last.num !== num || last.trail.length > 0) {
      rows.push({
        key: token.node.id,
        num,
        white: color === 'w' ? token : undefined,
        black: color === 'b' ? token : undefined,
        trail: [],
      });
    } else {
      last.black = token;
    }
  }
  if (group) attachGroup(group);
  return rows;
}

// ── Flow tree for the inline view ───────────────────────────────────────────
// The flat var-open/var-close/move token stream is bracket-matched (every
// var-open has a matching var-close) — rebuild it into a real nested
// structure so a variation can "pop out" onto its own indented line wherever
// it appears, instead of rendering as inline "( ... )" text.
type FlowMove = Extract<MoveListToken, { kind: 'move' }>;
type FlowItem = FlowMove | { kind: 'variation'; children: FlowItem[] };

function buildFlowTree(tokens: MoveListToken[]): FlowItem[] {
  let i = 0;
  function walk(): FlowItem[] {
    const items: FlowItem[] = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.kind === 'var-close') { i++; return items; }
      if (t.kind === 'var-open') {
        i++;
        items.push({ kind: 'variation', children: walk() });
        continue;
      }
      items.push(t as FlowMove);
      i++;
    }
    return items;
  }
  return walk();
}

export function MovesList({
  tokens, current, onSelect, onDeleteMove, onDeleteAfter, comments, meta, onSetComment, nags, onSetNags, gameId,
  timeFormat, timeIncrement,
}: MovesListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [refNode, setRefNode] = useState<GameNode | null>(null);
  const [savePosNode, setSavePosNode] = useState<GameNode | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useMovesView('board', 'inline');

  // Toggle a NAG: picking the one already set clears it.
  const handleToggleNag = (node: GameNode, code: number) => {
    const current = nags?.get(node.id) ?? [];
    onSetNags?.(node.id, current.includes(code) ? [] : [code]);
    setCtxMenu(null);
  };

  useEffect(() => {
    scrollActiveIntoView(activeRef.current);
  }, [current.id, view]);

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

  const verticalRows = useMemo(
    () => (view === 'vertical' ? buildVerticalRows(tokens) : []),
    [view, tokens],
  );
  const flowTree = useMemo(
    () => (view === 'inline' ? buildFlowTree(tokens) : []),
    [view, tokens],
  );

  if (tokens.length === 0) {
    return <p className="text-zinc-500 text-xs px-1">No moves yet.</p>;
  }

  const attachCtxHandlers = (node: GameNode) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, node });
    },
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        setCtxMenu({ x: touch.clientX, y: touch.clientY, node });
      }, 500);
    },
    onTouchEnd: clearLongPress,
    onTouchMove: clearLongPress,
  });

  const commentEditor = (node: GameNode, annos: NodeAnnotation[]) => (
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
  );

  // ── Inline token renderer — the classic flowing scoresheet. Also renders
  // variation groups inside the vertical view, so both views share one code
  // path for variations/comments/editing. ─────────────────────────────────────
  // Only ever called with 'move' tokens now — variations are structural
  // (FlowItem/renderFlow), not inline '(' / ')' text.
  const renderToken = (token: FlowMove) => {
    const { node, showMoveNumber, variationDepth } = token;
    const isActive = node.id === current.id;
    const isBlack = node.move!.color === 'b';
    const moveNum = getMoveNumber(node);
    const isVariation = variationDepth > 0;
    const annos = comments?.get(node.id) ?? [];
    const hasComment = annos.length > 0;
    const clk = meta?.get(node.id)?.clk;
    const evalText = meta?.get(node.id)?.evalText;
    const isEditing = editingNodeId === node.id;
    const nagInfo = NAG_BY_CODE.get(nags?.get(node.id)?.[0] ?? -1);
    const timeBand = timeFormat ? classifyTimeSpent(timeSpentFor(node, meta, timeIncrement ?? 0), timeFormat) : null;
    const timeBandMeta = timeBand ? TIME_BAND_META[timeBand] : null;

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
            {...attachCtxHandlers(node)}
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
          {/* Engine eval after this move, when the PGN carried [%eval]. */}
          {evalText != null && (
            <span className={`font-mono text-[10px] tabular-nums ml-0.5 ${evalTokenColor(evalText)}`}>{evalTokenLabel(evalText)}</span>
          )}
          {/* Clock remaining after this move, when the PGN carried [%clk] —
              tinted by the time-reviewer band when this move's think crossed
              a threshold for the game's time control. */}
          {clk != null && (
            <span
              title={timeBandMeta?.label}
              className={`font-mono text-[10px] tabular-nums ml-0.5 ${timeBandMeta?.color ?? 'text-zinc-500'}`}
            >
              {formatSeconds(clk)}
            </span>
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
        {isEditing && commentEditor(node, annos)}
      </Fragment>
    );
  };

  // ── Flow renderer (inline view): a run of moves flows normally; a
  // variation breaks out onto its own indented line with a └ connector
  // (Lichess-style "pop out"), then the outer flow resumes below it. ────────
  const renderFlow = (items: FlowItem[], keyPrefix: string) => {
    const out: React.ReactNode[] = [];
    let run: FlowMove[] = [];
    let n = 0;
    const flushRun = () => {
      if (run.length === 0) return;
      out.push(
        <span key={`${keyPrefix}-r${n++}`} className="inline-flex flex-wrap items-baseline gap-x-px gap-y-0.5">
          {run.map((t) => renderToken(t))}
        </span>,
      );
      run = [];
    };
    for (const item of items) {
      if ('kind' in item && item.kind === 'variation') {
        flushRun();
        const k = `${keyPrefix}-v${n++}`;
        out.push(
          <div key={k} className="flex items-start gap-1 ml-5 my-0.5">
            <span className="text-zinc-600 text-xs shrink-0 leading-6">└</span>
            <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-px gap-y-0.5 text-xs pl-1 border-l border-zinc-800">
              {renderFlow(item.children, k)}
            </div>
          </div>,
        );
      } else {
        run.push(item as FlowMove);
      }
    }
    flushRun();
    return out;
  };

  // ── Vertical half-cell: SAN + NAG left, eval/clock right — the reviewer's
  // reading rhythm, applied to the free board. ────────────────────────────────
  const renderVerticalHalf = (token: VerticalRow['white']) => {
    if (!token) return <div className="flex-1 min-w-0" />;
    const { node } = token;
    const isActive = node.id === current.id;
    const annos = comments?.get(node.id) ?? [];
    const hasComment = annos.length > 0;
    const clk = meta?.get(node.id)?.clk;
    const evalText = meta?.get(node.id)?.evalText;
    const nagInfo = NAG_BY_CODE.get(nags?.get(node.id)?.[0] ?? -1);
    const timeBand = timeFormat ? classifyTimeSpent(timeSpentFor(node, meta, timeIncrement ?? 0), timeFormat) : null;
    const timeBandMeta = timeBand ? TIME_BAND_META[timeBand] : null;

    return (
      <button
        ref={isActive ? activeRef : undefined}
        onClick={() => onSelect(node)}
        {...attachCtxHandlers(node)}
        className={[
          'flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1.5 rounded text-left select-none transition-colors',
          isActive ? 'bg-blue-700 hover:bg-blue-600' : hasComment ? 'bg-amber-500/10 hover:bg-zinc-800' : 'hover:bg-zinc-800 active:bg-zinc-700',
        ].join(' ')}
      >
        <span className={`font-mono text-sm shrink-0 ${isActive ? 'text-white font-semibold' : 'text-zinc-100'}`}>
          {node.move!.san}
        </span>
        {nagInfo && (
          <span className={`font-mono text-xs font-bold shrink-0 ${isActive ? 'text-white/80' : nagInfo.color}`}>{nagInfo.glyph}</span>
        )}
        <span className="ml-auto shrink-0 inline-flex items-baseline gap-1.5">
          {evalText != null && (
            <span className={`font-mono text-[11px] tabular-nums ${isActive ? 'text-blue-200' : evalTokenColor(evalText)}`}>
              {evalTokenLabel(evalText)}
            </span>
          )}
          {clk != null && (
            <span
              title={timeBandMeta?.label}
              className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-blue-200/70' : timeBandMeta?.color ?? 'text-zinc-600'}`}
            >
              {formatSeconds(clk)}
            </span>
          )}
        </span>
      </button>
    );
  };

  const verticalComments = (token: VerticalRow['white']) => {
    if (!token) return null;
    const { node } = token;
    const annos = comments?.get(node.id) ?? [];
    const isEditing = editingNodeId === node.id;
    if (isEditing) return commentEditor(node, annos);
    if (annos.length === 0) return null;
    return (
      <div className="pl-8 pr-2 pb-0.5 space-y-px">
        {annos.map((a, ai) => (
          <p key={ai} className={`text-xs tracking-tightest leading-tight font-[family-name:var(--font-jetbrains-mono)] ${SOURCE_STYLE[a.source]}`}>
            {a.text}
          </p>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* View toggle — top-right, out of the reading flow */}
      <div className="flex justify-end pb-1">
        <MovesViewToggle view={view} onChange={setView} />
      </div>

      {view === 'inline' ? (
        <div className="text-sm leading-6 overflow-y-auto">
          {renderFlow(flowTree, 'flow')}
        </div>
      ) : (
        <div className="space-y-px">
          {verticalRows.map((row) => (
            <div key={row.key}>
              <div className="flex items-center gap-0.5 min-w-0">
                <span className="text-zinc-500 text-xs font-mono w-7 shrink-0 text-right tabular-nums pr-0.5">
                  {row.num}.
                </span>
                {renderVerticalHalf(row.white)}
                {renderVerticalHalf(row.black)}
              </div>
              {verticalComments(row.white)}
              {verticalComments(row.black)}
              {/* Variations after this move — indented, classic inline flow */}
              {row.trail.map((group, gi) => (
                <div
                  key={gi}
                  className="ml-8 my-0.5 pl-2 border-l border-zinc-800 flex flex-wrap items-baseline gap-x-px gap-y-0.5 text-sm leading-6"
                >
                  {/* group[0]/[group.length-1] are the wrapping var-open/var-close —
                      the container div above already conveys "this is a variation",
                      so strip them and let any NESTED sub-variation pop out too. */}
                  {renderFlow(buildFlowTree(group.slice(1, -1)), `trail-${row.key}-${gi}`)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

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
