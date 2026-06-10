import { useState, useCallback, useMemo } from 'react';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Square, PieceSymbol } from 'chess.js';
import type { StoredAnnotation } from '@/lib/db';

// ─── Annotation types ─────────────────────────────────────────────────────────

type HistoryEntry =
  | { kind: 'arrow'; from: string; to: string }
  | { kind: 'highlight'; square: string };

type NodeAnnotations = {
  arrows: [string, string][];
  highlights: string[];
  history: HistoryEntry[];
};

const EMPTY_ANN: NodeAnnotations = { arrows: [], highlights: [], history: [] };
import {
  GameNode,
  createRootNode,
  addMove,
  getMainLine,
  toMainLinePgn,
  flattenTree,
  deleteMovesAfterNode,
  sanitizePgn,
  type NodeAnnotation,
  type NodeMeta,
} from '@/lib/gameTree';
import { extractNodeData } from '@/lib/pgnImport';

// Builds the per-node arrow/highlight state (incl. an undo history) from the
// arrows/highlights recovered out of a PGN's [%cal]/[%csl] tokens.
function annotationsFromImport(
  imported: Map<string, { arrows: [string, string][]; highlights: string[] }>,
): Map<string, NodeAnnotations> {
  const out = new Map<string, NodeAnnotations>();
  for (const [id, { arrows, highlights }] of imported) {
    out.set(id, {
      arrows,
      highlights,
      history: [
        ...arrows.map(([from, to]) => ({ kind: 'arrow', from, to } as HistoryEntry)),
        ...highlights.map((square) => ({ kind: 'highlight', square } as HistoryEntry)),
      ],
    });
  }
  return out;
}

// Persisted per-node data is keyed by main-line ply ('root' | '0' | '1' | …).
// Translate those stable keys back onto the freshly-rebuilt tree's node ids.
function mapFromPly<T>(
  rec: Record<string, T> | undefined,
  root: GameNode,
  mainNodes: GameNode[],
): Map<string, T> {
  const out = new Map<string, T>();
  if (!rec) return out;
  for (const [key, val] of Object.entries(rec)) {
    const node = key === 'root' ? root : mainNodes[Number(key)];
    if (node) out.set(node.id, val);
  }
  return out;
}

export function useBoardGame() {
  const initialRoot = createRootNode(DEFAULT_POSITION);
  const [root, setRoot] = useState<GameNode>(initialRoot);
  const [current, setCurrent] = useState<GameNode>(initialRoot);
  const [flipped, setFlipped] = useState(false);
  const [headers, setHeadersState] = useState<Record<string, string>>({});
  const [nodeComments, setNodeCommentsMap] = useState<Map<string, NodeAnnotation[]>>(new Map());
  const [nodeMeta, setNodeMetaMap] = useState<Map<string, NodeMeta>>(new Map());
  const [nags, setNagsMap] = useState<Map<string, number[]>>(new Map());
  // Incremented whenever the tree is structurally mutated (addMove) so memoised
  // consumers that depend on [root] get fresh values despite the in-place mutation.
  const [treeVersion, setTreeVersion] = useState(0);

  // Per-node annotation state (session-only).
  const [annotations, setAnnotations] = useState<Map<string, NodeAnnotations>>(new Map());

  // ─── Derived ──────────────────────────────────────────────────────────────

  const currentFen = current.fen;

  const legalMoves = useMemo(
    () => new Chess(currentFen).moves({ verbose: true }),
    [currentFen],
  );

  const mainLine = useMemo(() => getMainLine(root), [root, treeVersion]);

  const tokens = useMemo(() => flattenTree(root), [root, treeVersion]);

  // ─── Loading ──────────────────────────────────────────────────────────────

  // Returns false if the PGN couldn't be parsed so callers can surface an error
  // instead of failing silently. Sanitises mobile-paste quirks (curly quotes,
  // non-breaking spaces) that would otherwise make chess.js throw.
  const loadPgn = useCallback((pgn: string): boolean => {
    const clean = sanitizePgn(pgn);
    const chess = new Chess();
    try {
      chess.loadPgn(clean);
    } catch {
      return false;
    }
    const history = chess.history({ verbose: true });
    // Parse PGN header tags (chess.header() no-arg form is deprecated)
    const parsed: Record<string, string> = {};
    for (const m of clean.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) {
      parsed[m[1]] = m[2];
    }
    setHeadersState(parsed);

    const startFen = history[0]?.before ?? DEFAULT_POSITION;
    const newRoot = createRootNode(startFen);
    const mainNodes: GameNode[] = [];
    let node = newRoot;
    for (const move of history) {
      node = addMove(node, move, move.after);
      mainNodes.push(node);
    }

    // Recover comments / clk / eval / arrows / NAGs the PGN carried instead of
    // dropping them; original comments come in tagged source 'pgn'.
    const data = extractNodeData(chess, clean, newRoot, mainNodes);

    setRoot(newRoot);
    setCurrent(node);
    setTreeVersion(0);
    setAnnotations(annotationsFromImport(data.annotations));
    setNodeCommentsMap(data.comments);
    setNodeMetaMap(data.meta);
    setNagsMap(data.nags);
    return true;
  }, []);

  const setHeader = useCallback((key: string, value: string) => {
    setHeadersState(prev => {
      if (value === '') {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const loadFen = useCallback((fen: string) => {
    const newRoot = createRootNode(fen);
    setRoot(newRoot);
    setCurrent(newRoot);
    setTreeVersion(0);
    setAnnotations(new Map());
    setNodeCommentsMap(new Map());
    setNodeMetaMap(new Map());
    setNagsMap(new Map());
  }, []);

  // Fresh start: reset to the initial position and clear all game metadata.
  const newGame = useCallback(() => {
    const newRoot = createRootNode(DEFAULT_POSITION);
    setRoot(newRoot);
    setCurrent(newRoot);
    setTreeVersion(0);
    setAnnotations(new Map());
    setNodeCommentsMap(new Map());
    setNodeMetaMap(new Map());
    setNagsMap(new Map());
    setHeadersState({});
  }, []);

  // Edits only the user's own ('manual') comment on a node — comments imported
  // from the PGN ('pgn') or written by the reviewer ('reviewer') are preserved.
  const setNodeComment = useCallback((nodeId: string, text: string) => {
    setNodeCommentsMap(prev => {
      const next = new Map(prev);
      const others = (next.get(nodeId) ?? []).filter((a) => a.source !== 'manual');
      const trimmed = text.trim();
      const updated: NodeAnnotation[] = trimmed
        ? [...others, { source: 'manual', text: trimmed }]
        : others;
      if (updated.length) next.set(nodeId, updated);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  // Replaces the NAG codes on a node. An empty array clears them.
  const setNodeNags = useCallback((nodeId: string, codes: number[]) => {
    setNagsMap(prev => {
      const next = new Map(prev);
      if (codes.length) next.set(nodeId, codes);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  // ─── Move making ──────────────────────────────────────────────────────────

  const makeMove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol): boolean => {
      const chess = new Chess(current.fen);
      const move = chess.move({ from, to, ...(promotion ? { promotion } : {}) });
      if (!move) return false;
      const newNode = addMove(current, move, chess.fen());
      setCurrent(newNode);
      setTreeVersion((v) => v + 1);
      return true;
    },
    [current],
  );

  // ─── Navigation ───────────────────────────────────────────────────────────

  const goTo = useCallback((node: GameNode) => setCurrent(node), []);
  const goStart = useCallback(() => setCurrent(root), [root]);
  const goPrev = useCallback(() => setCurrent((c) => c.parent ?? c), []);
  const goNext = useCallback(() => setCurrent((c) => c.children[0] ?? c), []);
  const goEnd = useCallback(() => {
    setCurrent((c) => {
      let node = c;
      while (node.children[0]) node = node.children[0];
      return node;
    });
  }, []);
  const flipBoard = useCallback(() => setFlipped((f) => !f), []);

  // ─── Export ───────────────────────────────────────────────────────────────

  const exportPgn = useCallback(() => toMainLinePgn(root, headers, {
    comments: nodeComments,
    meta: nodeMeta,
    annotations: new Map(
      [...annotations.entries()].map(([id, ann]) => [id, { arrows: ann.arrows, highlights: ann.highlights }])
    ),
    nags,
  }), [root, headers, nodeComments, nodeMeta, annotations, nags]);

  // ─── Tree editing ─────────────────────────────────────────────────────────

  // Removes a single move node and all its descendants.
  const deleteMove = useCallback((targetNode: GameNode) => {
    const parent = targetNode.parent;
    if (!parent) return;
    parent.children = parent.children.filter((c) => c !== targetNode);
    // If current was targetNode or any descendant, go to parent.
    let check: GameNode | null = current;
    while (check) {
      if (check === targetNode) { setCurrent(parent); break; }
      check = check.parent;
    }
    setTreeVersion((v) => v + 1);
  }, [current]);

  // Removes all moves after targetNode (clears its children).
  const deleteAfter = useCallback((targetNode: GameNode) => {
    deleteMovesAfterNode(targetNode);
    // If current is a descendant of targetNode, navigate to targetNode.
    let check: GameNode | null = current.parent;
    while (check) {
      if (check === targetNode) { setCurrent(targetNode); break; }
      check = check.parent;
    }
    setTreeVersion((v) => v + 1);
  }, [current]);

  // ─── Load from library ────────────────────────────────────────────────────

  const loadFromLibrary = useCallback((
    pgn: string,
    savedHeaders: Record<string, string>,
    savedComments: Record<string, NodeAnnotation[]>,
    savedAnnotations: Record<string, StoredAnnotation>,
    savedNags?: Record<string, number[]>,
    savedMeta?: Record<string, NodeMeta>,
  ) => {
    const chess = new Chess();
    try {
      chess.loadPgn(sanitizePgn(pgn));
    } catch {
      return; // leave the current board untouched rather than crashing
    }
    const history = chess.history({ verbose: true });

    const startFen = history[0]?.before ?? DEFAULT_POSITION;
    const newRoot = createRootNode(startFen);
    const mainNodes: GameNode[] = [];
    let node = newRoot;
    for (const move of history) {
      node = addMove(node, move, move.after);
      mainNodes.push(node);
    }

    setRoot(newRoot);
    setCurrent(node);
    setTreeVersion(0);
    setHeadersState({ ...savedHeaders });
    setNodeCommentsMap(mapFromPly(savedComments, newRoot, mainNodes));
    setNodeMetaMap(mapFromPly(savedMeta, newRoot, mainNodes));
    setNagsMap(mapFromPly(savedNags, newRoot, mainNodes));
    setAnnotations(mapFromPly(savedAnnotations, newRoot, mainNodes) as Map<string, NodeAnnotations>);
  }, []);

  // ─── Annotations ──────────────────────────────────────────────────────────

  const currentAnn = annotations.get(current.id) ?? EMPTY_ANN;

  // Toggles an arrow on the current node (same arrow twice removes it).
  const addArrow = useCallback((from: string, to: string) => {
    setAnnotations((prev) => {
      const cur = prev.get(current.id) ?? EMPTY_ANN;
      const exists = cur.arrows.some((a) => a[0] === from && a[1] === to);
      const next = new Map(prev);
      next.set(current.id, exists
        ? {
            arrows: cur.arrows.filter((a) => !(a[0] === from && a[1] === to)),
            highlights: cur.highlights,
            history: cur.history.filter(
              (h) => !(h.kind === 'arrow' && h.from === from && h.to === to),
            ),
          }
        : {
            arrows: [...cur.arrows, [from, to]],
            highlights: cur.highlights,
            history: [...cur.history, { kind: 'arrow', from, to }],
          });
      return next;
    });
  }, [current.id]);

  // Toggles a square highlight on the current node.
  const addHighlight = useCallback((square: string) => {
    setAnnotations((prev) => {
      const cur = prev.get(current.id) ?? EMPTY_ANN;
      const exists = cur.highlights.includes(square);
      const next = new Map(prev);
      next.set(current.id, exists
        ? {
            arrows: cur.arrows,
            highlights: cur.highlights.filter((s) => s !== square),
            history: cur.history.filter(
              (h) => !(h.kind === 'highlight' && h.square === square),
            ),
          }
        : {
            arrows: cur.arrows,
            highlights: [...cur.highlights, square],
            history: [...cur.history, { kind: 'highlight', square }],
          });
      return next;
    });
  }, [current.id]);

  // Removes the most recently added annotation (LIFO).
  const removeLastDecoration = useCallback(() => {
    setAnnotations((prev) => {
      const cur = prev.get(current.id);
      if (!cur || cur.history.length === 0) return prev;
      const last = cur.history[cur.history.length - 1];
      const next = new Map(prev);
      next.set(current.id, {
        arrows: last.kind === 'arrow'
          ? cur.arrows.filter((a) => !(a[0] === last.from && a[1] === last.to))
          : cur.arrows,
        highlights: last.kind === 'highlight'
          ? cur.highlights.filter((s) => s !== last.square)
          : cur.highlights,
        history: cur.history.slice(0, -1),
      });
      return next;
    });
  }, [current.id]);

  return {
    root,
    current,
    flipped,
    currentFen,
    legalMoves,
    mainLine,
    tokens,
    headers,
    setHeader,
    loadPgn,
    loadFen,
    newGame,
    makeMove,
    goTo,
    goStart,
    goPrev,
    goNext,
    goEnd,
    flipBoard,
    exportPgn,
    nodeComments,
    setNodeComment,
    nodeMeta,
    nags,
    setNodeNags,
    // Annotations (derived from current node)
    annotationArrows: currentAnn.arrows,
    annotationHighlights: currentAnn.highlights,
    hasAnnotations: currentAnn.history.length > 0,
    allAnnotations: annotations,
    addArrow,
    addHighlight,
    removeLastDecoration,
    // Tree editing
    deleteMove,
    deleteAfter,
    // Library
    isDirty: root.children.length > 0,
    loadFromLibrary,
  };
}
