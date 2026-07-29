'use client';
import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type FC } from 'react';

// useLayoutEffect fires synchronously after DOM commit (before paint), so
// getBoundingClientRect always returns real values. Falls back to useEffect on
// the server where layout APIs are unavailable.
const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, Piece, PromotionPieceOption, CustomSquareProps } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { Chess } from 'chess.js';
import type { Square, PieceSymbol } from 'chess.js';
import { PIECE_CP } from '@/lib/classification';
import { useBoardGame } from '@/hooks/useBoardGame';
import { useBoardEngine } from '@/hooks/useBoardEngine';
import { EvalBar } from './EvalBar';
import { MovesList } from './MovesList';
import { EngineLines } from './EngineLines';
import { BoardControls } from './BoardControls';
import { FenBar } from './FenBar';
import { GameInfoModal } from './GameInfoModal';
import { LibraryModal } from './LibraryModal';
import { clocksAt, ClockChip } from './ClockDisplay';
import { DecorationMenu, type DecorationCommit, type EditingKind } from './DecorationMenu';
import { SavePositionDialog } from '@/components/blunderable/SavedPositions';
import { saveGame, updateGame, serializeBoardState, checkDuplicate, saveDraft, loadDraft, clearDraft, getAdjacentGame } from '@/lib/library';
import { gameFormat, timeControlIncrement } from '@/lib/gameMeta';
import type { LibraryGame } from '@/lib/db';
import {
  ARROW_RENDER_COLOR,
  HIGHLIGHT_RENDER_COLOR,
  DEFAULT_COLOR,
  newDecorationId,
  type DecorationColor,
  type AnimationEffect,
} from '@/lib/decorations';
import { NAG_BY_CODE } from '@/lib/nags';

// ─── Player row (name + clock, one per side) ───────────────────────────────────

// One player's name/rating + clock, riding directly above or below the board
// (lichess-mobile style) rather than both sides bundled in a side-panel card.
// The clock is always right-aligned regardless of which side of the board
// this row represents. Clicking opens the game-data editor; Event/Date (when
// present) rides along on the top row only, so it isn't duplicated.
function PlayerRow({
  color, headers, clock, active, showEventDate, onOpen,
}: {
  color: 'w' | 'b';
  headers: Record<string, string>;
  clock?: number;
  active: boolean;
  showEventDate: boolean;
  onOpen: () => void;
}) {
  const name = color === 'w' ? headers.White : headers.Black;
  const elo = color === 'w' ? headers.WhiteElo : headers.BlackElo;
  const { Event: event, Date: date } = headers;
  if (!name && clock === undefined && !(showEventDate && (event || date))) return null;

  return (
    <div className="w-full mb-1.5 last:mb-0 rounded-sm overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={[
          'flex items-center justify-between gap-2 cursor-pointer min-w-0 px-2.5 py-2 transition-colors border',
          color === 'w'
            ? 'bg-zinc-100 hover:bg-white border-zinc-300'
            : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800',
        ].join(' ')}
      >
        <span className={`flex items-baseline gap-1.5 min-w-0 truncate text-sm font-bold ${color === 'w' ? 'text-zinc-900' : 'text-zinc-100'}`}>
          <span className="truncate">{name ?? '?'}</span>
          {elo && <span className="text-xs font-normal tabular-nums text-zinc-500 shrink-0">{elo}</span>}
        </span>
        {clock !== undefined && <ClockChip time={clock} active={active} />}
      </div>

      {showEventDate && (event || date) && (
        <div
          role="button"
          tabIndex={-1}
          onClick={onOpen}
          className="flex items-center justify-between px-2.5 py-1 bg-zinc-800/40 border-x border-b border-zinc-700/40 cursor-pointer"
        >
          <span className="text-xs font-semibold text-zinc-400 truncate pr-2">{event ?? ''}</span>
          <span className="text-xs font-semibold text-zinc-400 shrink-0 tabular-nums">{date ?? ''}</span>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pieceColor(piece: Piece): 'w' | 'b' {
  return piece[0] as 'w' | 'b';
}

function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] as 'w' | 'b';
}

function promotionPiece(opt: PromotionPieceOption): PieceSymbol {
  return opt[1].toLowerCase() as PieceSymbol;
}

// ─── Unsaved prompt ───────────────────────────────────────────────────────────

function UnsavedPrompt({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl p-5 w-full max-w-sm">
        <p className="text-sm font-semibold text-zinc-100 mb-1">Unsaved changes</p>
        <p className="text-xs text-zinc-400 mb-5">
          The current board has unsaved changes. Save to Library before loading, or discard them.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
          >
            Save to Library
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BoardShell ───────────────────────────────────────────────────────────────

interface BoardShellProps {
  initialPgn?: string;
  initialFen?: string;
}

export function BoardShell({ initialPgn, initialFen }: BoardShellProps) {
  const game = useBoardGame();
  const engine = useBoardEngine(game.currentFen);

  // Eval-bar source: live engine when it's on, else the current node's stored
  // [%eval] token (imported PGNs / reviewer-enriched games carry these — the
  // bar used to ignore them and sit frozen at 50% unless the engine ran).
  // PGN [%eval] is White-POV by spec: "+0.24" → cp, "#3"/"#-2" → mate.
  const nodeEval = useMemo((): { cp: number; mate: number | null } | null => {
    const raw = game.nodeMeta.get(game.current.id)?.evalText;
    if (!raw) return null;
    if (raw.startsWith('#')) {
      const m = parseInt(raw.slice(1), 10);
      if (!Number.isFinite(m)) return null;
      return { cp: m >= 0 ? 10000 : -10000, mate: m };
    }
    const n = parseFloat(raw);
    return Number.isFinite(n) ? { cp: Math.round(n * 100), mate: null } : null;
  }, [game.nodeMeta, game.current.id]);

  const barScore = engine.enabled ? engine.evalScore : (nodeEval?.cp ?? null);
  const barMate = engine.enabled ? engine.evalMate : (nodeEval?.mate ?? null);

  // Player rows: whichever colour sits at the bottom of the board (matching
  // boardOrientation below) gets the row below the board; the other rides
  // above it.
  const bottomColor: 'w' | 'b' = game.flipped ? 'b' : 'w';
  const topColor: 'w' | 'b' = game.flipped ? 'w' : 'b';
  const clocks = clocksAt(game.current, game.nodeMeta);
  const sideToMoveColor = sideToMove(game.currentFen);

  const initApplied = useRef(false);
  // Guards the autosave effect: it must not run until the mount-time draft
  // restore has settled, otherwise the empty initial board would clear the draft.
  const restoreDone = useRef(false);
  useEffect(() => {
    if (initApplied.current) return;
    initApplied.current = true;
    // An explicit ?pgn/?fen wins over any saved draft.
    if (initialPgn) { game.loadPgn(initialPgn); restoreDone.current = true; return; }
    if (initialFen) { game.loadFen(initialFen); restoreDone.current = true; return; }
    // Otherwise restore the autosaved draft, if any.
    loadDraft()
      .then((draft) => {
        if (draft?.pgn) {
          game.loadFromLibrary(draft.pgn, draft.headers, draft.nodeComments, draft.annotations, draft.nags, draft.nodeMeta);
        }
      })
      .catch(() => {})
      .finally(() => { restoreDone.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Draft autosave (single slot, debounced) ────────────────────────────────
  // Watches the serialisable board state. exportPgn's identity is stable across
  // pure move additions (root is mutated in place), so we depend on tokens /
  // headers / comments / annotations, which do change identity.
  useEffect(() => {
    if (!restoreDone.current) return;
    const snapshot = {
      exportPgn: game.exportPgn,
      headers: game.headers,
      mainLine: game.mainLine,
      nodeComments: game.nodeComments,
      nodeMeta: game.nodeMeta,
      allAnnotations: game.allAnnotations,
      nags: game.nags,
    };
    const dirty = game.isDirty;
    const timer = setTimeout(() => {
      if (dirty) saveDraft(snapshot).catch(() => {});
      else clearDraft().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.tokens, game.headers, game.nodeComments, game.nodeMeta, game.allAnnotations, game.nags, game.isDirty]);

  // ── Desktop/mobile detection ───────────────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Board width ────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useMeasureEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const apply = (w: number) => {
      if (w > 0) setBoardWidth(Math.min(Math.floor(w), 560));
    };

    const bcr = el.getBoundingClientRect();
    apply(bcr.width || Math.min(window.innerWidth * 0.9, window.innerHeight * 0.9, 560));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => apply(entries[0]?.contentRect.width ?? 0));
      ro.observe(el);
      return () => ro.disconnect();
    }
    const onResize = () => apply(el.getBoundingClientRect().width || Math.min(window.innerWidth * 0.9, window.innerHeight * 0.9, 560));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Game info modal ────────────────────────────────────────────────────────
  const [showGameInfo, setShowGameInfo] = useState(false);

  // ── Engine visibility (EvalBar + EngineLines) — hidden by default ──────────
  const [showEngine, setShowEngine] = useState(false);

  // ── Save current position to practice (/blunderable) ────────────────────────
  const [showSavePosition, setShowSavePosition] = useState(false);

  // ── Library ────────────────────────────────────────────────────────────────
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryMode, setLibraryMode] = useState<'browse' | 'save'>('browse');
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [loadedFromLibraryId, setLoadedFromLibraryId] = useState<string | null>(null);
  const [loadedFromFolderId, setLoadedFromFolderId] = useState<string | null>(null);
  const pendingLoadRef = useRef<LibraryGame | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const doLoad = useCallback((libGame: LibraryGame) => {
    game.loadFromLibrary(
      libGame.pgn,
      libGame.headers,
      libGame.nodeComments,
      libGame.annotations,
      libGame.nags,
      libGame.nodeMeta,
    );
    setLoadedFromLibraryId(libGame.id);
    setLoadedFromFolderId(libGame.folderId);
    setShowLibrary(false);
  }, [game]);

  // Step to the previous/next game in the loaded game's folder without opening
  // the library. No-op (with a toast) at the ends of the folder.
  const loadAdjacent = useCallback(async (dir: 1 | -1) => {
    if (!loadedFromLibraryId || !loadedFromFolderId) return;
    const next = await getAdjacentGame(loadedFromFolderId, loadedFromLibraryId, dir);
    if (next) doLoad(next);
    else showToast(dir === 1 ? 'Last game in folder' : 'First game in folder');
  }, [loadedFromLibraryId, loadedFromFolderId, doLoad, showToast]);

  const handleSaveToLibrary = useCallback(async (folderId: string) => {
    const payload = serializeBoardState(folderId, {
      exportPgn: game.exportPgn,
      headers: game.headers,
      mainLine: game.mainLine,
      nodeComments: game.nodeComments,
      nodeMeta: game.nodeMeta,
      allAnnotations: game.allAnnotations,
      nags: game.nags,
    });
    if (loadedFromLibraryId) {
      await updateGame(loadedFromLibraryId, payload);
      showToast('Library game updated');
    } else {
      const isDup = await checkDuplicate(folderId, payload.pgn);
      if (isDup) {
        showToast('This game is already in this folder');
        setLibraryMode('browse');
        setShowLibrary(false);
        return;
      }
      const saved = await saveGame(payload);
      setLoadedFromLibraryId(saved.id);
      showToast('Game saved to Library');
    }
    setLibraryMode('browse');
    setShowLibrary(false);
    if (pendingLoadRef.current) {
      doLoad(pendingLoadRef.current);
      pendingLoadRef.current = null;
    }
  }, [game, doLoad, loadedFromLibraryId, showToast]);

  const handleLoadFromLibrary = useCallback((libGame: LibraryGame) => {
    if (game.isDirty) {
      pendingLoadRef.current = libGame;
      setShowLibrary(false);
      setShowUnsavedPrompt(true);
    } else {
      doLoad(libGame);
    }
  }, [game.isDirty, doLoad]);

  // Wrap load callbacks so a fresh PGN/FEN clears the library-loaded-game tracking.
  const handlePgnLoad = useCallback((pgn: string): boolean => {
    const ok = game.loadPgn(pgn);
    if (ok) { setLoadedFromLibraryId(null); setLoadedFromFolderId(null); }
    else showToast('Could not read that PGN — check the moves and try again');
    return ok;
  }, [game, showToast]);

  const handleFenLoad = useCallback((fen: string) => {
    game.loadFen(fen);
    setLoadedFromLibraryId(null);
    setLoadedFromFolderId(null);
  }, [game]);

  const handleNewGame = useCallback(() => {
    game.newGame();
    setLoadedFromLibraryId(null);
    setLoadedFromFolderId(null);
  }, [game]);

  const openLibrary = useCallback((mode: 'browse' | 'save') => {
    setLibraryMode(mode);
    setShowLibrary(true);
  }, []);

  // The decoration (arrow/highlight/animation), if any, currently anchored at
  // a clicked square — set on a plain inert click so a manual delete "×" can
  // be shown for it (see the capture-overlay/badge rendering further below).
  const [focused, setFocused] = useState<{ kind: EditingKind; id: string } | null>(null);

  // First decoration (in stored order) anchored at `square` — an arrow whose
  // from/to matches it, else a highlight/animation whose covered squares
  // include it. Drives both edit-vs-create detection when the popup opens,
  // and left-click focus-selection for the manual delete badge.
  const findDecorationAt = useCallback((square: string): { kind: EditingKind; id: string } | null => {
    const arrow = game.annotationArrows.find((a) => a.from === square || a.to === square);
    if (arrow) return { kind: 'arrow', id: arrow.id };
    const highlight = game.annotationHighlights.find((h) => (h.squares ?? [h.square]).includes(square));
    if (highlight) return { kind: 'highlight', id: highlight.id };
    const animation = game.annotationAnimations.find((a) => a.square === square);
    if (animation) return { kind: 'animation', id: animation.id };
    return null;
  }, [game.annotationArrows, game.annotationHighlights, game.annotationAnimations]);

  // ── Click-to-move ──────────────────────────────────────────────────────────
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: Square; to: Square } | null>(null);

  useEffect(() => { setSelectedSq(null); setFocused(null); }, [game.currentFen]);

  const mover = sideToMove(game.currentFen);

  const legalDests = useMemo(() => {
    if (!selectedSq) return new Set<string>();
    return new Set(
      game.legalMoves.filter((m) => m.from === selectedSq).map((m) => m.to),
    );
  }, [selectedSq, game.legalMoves]);

  const handleSquareClick = useCallback(
    (sq: CbSquare, piece: Piece | undefined) => {
      const square = sq as Square;
      // Moves and piece selection always win. An inert click (empty/opponent
      // square with nothing selected) now *focuses* whatever decoration is
      // anchored there — showing a manual delete "×" — instead of silently
      // discarding the most recent decoration, which made building up
      // several arrows/zones fragile (any stray click elsewhere used to
      // delete the last one).
      if (selectedSq && legalDests.has(square)) {
        const moved = game.makeMove(selectedSq, square);
        setSelectedSq(moved ? null : selectedSq);
        return;
      }
      if (piece && pieceColor(piece) === mover) {
        setSelectedSq(square);
        return;
      }
      if (!selectedSq) {
        setFocused(findDecorationAt(square));
        return;
      }
      setSelectedSq(null);
    },
    [selectedSq, legalDests, mover, game, findDecorationAt],
  );

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const handlePieceDrop = useCallback(
    (from: CbSquare, to: CbSquare): boolean => {
      setSelectedSq(null);
      return game.makeMove(from as Square, to as Square);
    },
    [game],
  );

  // ── Promotion ──────────────────────────────────────────────────────────────
  const handlePromotionCheck = useCallback(
    (from: CbSquare, to: CbSquare, piece: Piece): boolean => {
      const isWhitePawn = piece === 'wP' && from[1] === '7' && to[1] === '8';
      const isBlackPawn = piece === 'bP' && from[1] === '2' && to[1] === '1';
      if (isWhitePawn || isBlackPawn) {
        setPendingPromo({ from: from as Square, to: to as Square });
        return true;
      }
      return false;
    },
    [],
  );

  const handlePromotionSelect = useCallback(
    (opt?: PromotionPieceOption, from?: CbSquare, to?: CbSquare): boolean => {
      const src = (from as Square | undefined) ?? pendingPromo?.from;
      const dst = (to as Square | undefined) ?? pendingPromo?.to;
      if (!src || !dst || !opt) { setPendingPromo(null); return false; }
      const result = game.makeMove(src, dst, promotionPiece(opt));
      setPendingPromo(null);
      setSelectedSq(null);
      return result;
    },
    [game, pendingPromo],
  );

  // ── Decorations: right-click / long-press popup ───────────────────────────
  // Squares are resolved from pointer coordinates via the library's own
  // data-square attributes (orientation-proof, works over piece images and
  // coordinate labels).
  type ArmedTool =
    | { kind: 'arrow'; from: string; color: DecorationColor }
    | { kind: 'zone-highlight'; color: DecorationColor }
    | null;

  const rightMouseDownSquare = useRef<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; square: string; editing: EditingKind; editId: string | null } | null>(null);
  const [armed, setArmed] = useState<ArmedTool>(null);
  const [zoneDragStart, setZoneDragStart] = useState<{ x: number; y: number; squareSize: number } | null>(null);
  const [zoneDragEnd, setZoneDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [playingAnimIds, setPlayingAnimIds] = useState<Set<string>>(new Set());

  const squareFromPoint = useCallback((x: number, y: number): string | null => {
    const el = document
      .elementsFromPoint(x, y)
      .find((e) => e.hasAttribute('data-square'));
    return el?.getAttribute('data-square') ?? null;
  }, []);

  // Squares whose DOM element's centre falls within half a square-width of
  // the start→end drag segment (clamped to the segment's length) — a
  // "capsule" selection along the drag vector. Handles any angle with one
  // test, so a diagonal drag selects the actual diagonal band of squares
  // instead of the bounding rectangle between the two points.
  const squaresAlongDrag = useCallback((start: { x: number; y: number }, end: { x: number; y: number }): string[] => {
    const container = containerRef.current;
    if (!container) return [];
    const squareEls = container.querySelectorAll('[data-square]');
    let squareSize = 0;
    squareEls.forEach((el) => { if (!squareSize) squareSize = el.getBoundingClientRect().width; });
    const halfWidth = squareSize / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    const out: string[] = [];
    squareEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((cx - start.x) * dx + (cy - start.y) * dy) / lenSq));
      const px = start.x + t * dx;
      const py = start.y + t * dy;
      if (Math.hypot(cx - px, cy - py) <= halfWidth) out.push(el.getAttribute('data-square')!);
    });
    return out;
  }, []);

  const openMenuAt = useCallback((clientX: number, clientY: number) => {
    const square = squareFromPoint(clientX, clientY);
    if (!square) return;
    const found = findDecorationAt(square);
    setMenu({ x: clientX, y: clientY, square, editing: found?.kind ?? null, editId: found?.id ?? null });
  }, [squareFromPoint, findDecorationAt]);

  // Marks an animation as "currently playing" for ~700ms — long enough for a
  // one-shot CSS animation to run — then lets it settle back to a plain
  // static square, per the one-shot-then-static design.
  const playAnimation = useCallback((id: string) => {
    setPlayingAnimIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setPlayingAnimIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 700);
  }, []);

  const handleBoardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) rightMouseDownSquare.current = squareFromPoint(e.clientX, e.clientY);
    },
    [squareFromPoint],
  );

  // Plain right-click (mouseup on the same square as mousedown, no drag)
  // opens the popup. A right-drag to a different square is a no-op unless a
  // tool is already armed — the capture overlay below handles that case.
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const start = rightMouseDownSquare.current;
      rightMouseDownSquare.current = null;
      if (!start || armed) return;
      const end = squareFromPoint(e.clientX, e.clientY);
      if (end === start) openMenuAt(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, [squareFromPoint, openMenuAt, armed]);

  // Touch long-press (3s) opens the same popup.
  const handleBoardTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const { clientX, clientY } = touch;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      openMenuAt(clientX, clientY);
    }, 3000);
  }, [openMenuAt]);
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  // Escape cancels an armed tool (arrow-drawing / zone-drag) without committing.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setArmed(null); setZoneDragStart(null); setZoneDragEnd(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);

  const handleMenuCommit = useCallback((commit: DecorationCommit) => {
    if (!menu) return;
    const { square, editId } = menu;
    switch (commit.kind) {
      case 'recolor':
        if (editId) game.recolorDecoration(editId, commit.color);
        break;
      case 'delete':
        if (editId) game.removeDecoration(editId);
        break;
      case 'replay':
        if (editId) playAnimation(editId);
        break;
      case 'arrow':
        setArmed({ kind: 'arrow', from: square, color: commit.color });
        break;
      case 'highlight':
        if (commit.target === 'square') game.addHighlight(square, commit.color);
        else setArmed({ kind: 'zone-highlight', color: commit.color });
        break;
      case 'animate': {
        const id = newDecorationId();
        game.addAnimation(square, commit.effect, undefined, id);
        playAnimation(id);
        break;
      }
    }
  }, [menu, game, playAnimation]);

  // While a tool is armed, a transparent overlay captures every pointer event
  // over the board (mouse and touch alike) so the chessboard's own piece-drag
  // handling never sees them — the gesture is finishing a decoration instead
  // of moving a piece.
  const handleArmedPointerDown = useCallback((e: React.PointerEvent) => {
    if (armed?.kind === 'zone-highlight') {
      const squareSize = containerRef.current?.querySelector('[data-square]')?.getBoundingClientRect().width ?? 0;
      setZoneDragStart({ x: e.clientX, y: e.clientY, squareSize });
      setZoneDragEnd({ x: e.clientX, y: e.clientY });
    }
  }, [armed]);

  const handleArmedPointerMove = useCallback((e: React.PointerEvent) => {
    if (!zoneDragStart) return;
    setZoneDragEnd({ x: e.clientX, y: e.clientY });
  }, [zoneDragStart]);

  const handleArmedPointerUp = useCallback((e: React.PointerEvent) => {
    if (armed?.kind === 'arrow') {
      const dest = squareFromPoint(e.clientX, e.clientY);
      if (dest) game.addArrow(armed.from, dest, armed.color);
    } else if (armed?.kind === 'zone-highlight' && zoneDragStart) {
      const squares = squaresAlongDrag(zoneDragStart, { x: e.clientX, y: e.clientY });
      if (squares.length > 0) game.addHighlight(squares[0], armed.color, squares);
    }
    setArmed(null);
    setZoneDragStart(null);
    setZoneDragEnd(null);
  }, [armed, zoneDragStart, squareFromPoint, squaresAlongDrag, game]);

  // Screen-space anchor for the focused decoration's manual-delete "×" — a
  // highlight/animation anchors at its square, an arrow at the midpoint
  // between its two endpoint squares.
  const decorationAnchorRect = useCallback((kind: EditingKind, id: string): DOMRect | null => {
    const container = containerRef.current;
    if (!container) return null;
    if (kind === 'arrow') {
      const arrow = game.annotationArrows.find((a) => a.id === id);
      if (!arrow) return null;
      const fromEl = container.querySelector(`[data-square="${arrow.from}"]`);
      const toEl = container.querySelector(`[data-square="${arrow.to}"]`);
      if (!fromEl || !toEl) return null;
      const r1 = fromEl.getBoundingClientRect();
      const r2 = toEl.getBoundingClientRect();
      const cx = (r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2;
      const cy = (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2;
      return new DOMRect(cx - 10, cy - 10, 20, 20);
    }
    const square = kind === 'highlight'
      ? game.annotationHighlights.find((h) => h.id === id)?.square
      : game.annotationAnimations.find((a) => a.id === id)?.square;
    if (!square) return null;
    const el = container.querySelector(`[data-square="${square}"]`);
    return el?.getBoundingClientRect() ?? null;
  }, [game.annotationArrows, game.annotationHighlights, game.annotationAnimations]);

  // Recomputed in an effect (not read during render — refs/DOM measurement
  // must happen outside render) whenever the focus, board layout, or the
  // decorations themselves change.
  const [focusedRect, setFocusedRect] = useState<DOMRect | null>(null);
  useMeasureEffect(() => {
    setFocusedRect(focused ? decorationAnchorRect(focused.kind, focused.id) : null);
  }, [focused, decorationAnchorRect, boardWidth, game.flipped]);

  // ── Square styles ──────────────────────────────────────────────────────────
  // Only the last-move tint and the selected-square/legal-move dots — user
  // highlights render through `customSquare` below instead (as stacked,
  // individually semi-transparent layers), so overlapping highlights actually
  // blend visually rather than one flat backgroundColor silently overwriting
  // another.
  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string | number>> = {};
    if (game.current.move) {
      const tint = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
      styles[game.current.move.from] = tint;
      styles[game.current.move.to] = tint;
    }
    if (selectedSq) {
      styles[selectedSq] = { backgroundColor: 'rgba(20, 85, 30, 0.5)' };
      legalDests.forEach((dest) => {
        styles[dest] = {
          background: 'radial-gradient(circle, rgba(0,0,0,0.2) 28%, transparent 28%)',
        };
      });
    }

    // ── Check + hanging-piece (threat) highlighting ─────────────────────────
    try {
      const chess = new Chess(game.currentFen);
      if (chess.isCheck()) {
        const kingColor = chess.turn();
        for (const row of chess.board()) {
          for (const sq of row) {
            if (sq && sq.type === 'k' && sq.color === kingColor) {
              styles[sq.square] = { ...styles[sq.square], backgroundColor: 'rgba(220, 38, 38, 0.55)' };
            }
          }
        }
      }
      // A piece is "hanging" when it's attacked and either wholly undefended,
      // or the cheapest attacker is worth less than it — a losing trade even
      // after a recapture. Cheap 2-ply heuristic (attackers() + PIECE_CP), not
      // full SEE.
      for (const row of chess.board()) {
        for (const sq of row) {
          if (!sq) continue;
          const attackers = chess.attackers(sq.square, sq.color === 'w' ? 'b' : 'w');
          if (attackers.length === 0) continue;
          const defenders = chess.attackers(sq.square, sq.color);
          const cheapestAttacker = Math.min(...attackers.map((a) => PIECE_CP[chess.get(a)?.type ?? 'p']));
          const hanging = defenders.length === 0 || cheapestAttacker < PIECE_CP[sq.type];
          if (hanging) {
            styles[sq.square] = { ...styles[sq.square], backgroundColor: 'rgba(234, 88, 12, 0.35)' };
          }
        }
      }
    } catch { /* malformed FEN mid-edit — skip threat highlighting for this render */ }

    return styles;
  }, [game.current, selectedSq, legalDests]);

  // ── Arrows ─────────────────────────────────────────────────────────────────
  const allArrows = useMemo((): [CbSquare, CbSquare, string][] => {
    const userArrows = game.annotationArrows.map(
      (a) => [a.from as CbSquare, a.to as CbSquare, ARROW_RENDER_COLOR[a.color ?? DEFAULT_COLOR]] as [CbSquare, CbSquare, string],
    );
    const pv0 = engine.lines[0]?.pv[0];
    const engineArrow: [CbSquare, CbSquare, string][] =
      pv0 && pv0.length >= 4
        ? [[pv0.slice(0, 2) as CbSquare, pv0.slice(2, 4) as CbSquare, 'rgba(0,120,255,0.55)']]
        : [];
    return [...engineArrow, ...userArrows];
  }, [game.annotationArrows, engine.lines]);

  // ── Highlights (stacked, per-decoration layers so overlaps blend) ─────────
  const highlightsBySquare = useMemo(() => {
    const map = new Map<string, { id: string; color: string }[]>();
    for (const h of game.annotationHighlights) {
      const color = HIGHLIGHT_RENDER_COLOR[h.color ?? DEFAULT_COLOR];
      for (const sq of h.squares ?? [h.square]) {
        const arr = map.get(sq) ?? [];
        arr.push({ id: h.id, color });
        map.set(sq, arr);
      }
    }
    return map;
  }, [game.annotationHighlights]);

  // ── Animations (one-shot, piece-scoped) ────────────────────────────────────
  const activeAnimBySquare = useMemo(() => {
    const map = new Map<string, AnimationEffect>();
    for (const a of game.annotationAnimations) {
      if (playingAnimIds.has(a.id)) map.set(a.square, a.effect);
    }
    return map;
  }, [game.annotationAnimations, playingAnimIds]);

  // ── NAG glyph badge (current move's destination square) ───────────────────
  const currentNagGlyph = useMemo(() => {
    const move = game.current.move;
    if (!move) return null;
    const codes = game.nags.get(game.current.id);
    const nag = codes?.length ? NAG_BY_CODE.get(codes[0]) : undefined;
    return nag ? { square: move.to, nag } : null;
  }, [game.current, game.nags]);

  const customSquare: FC<CustomSquareProps> | undefined = useMemo(() => {
    if (highlightsBySquare.size === 0 && activeAnimBySquare.size === 0 && !currentNagGlyph) return undefined;
    return function DecoratedSquare({ children, ref, square, style }: CustomSquareProps) {
      const colors = highlightsBySquare.get(square as string);
      const animEffect = activeAnimBySquare.get(square as string);
      const pieceWrapClass = animEffect ? `decoration-${animEffect}` : undefined;
      return (
        <div ref={ref} style={{ ...style, position: 'relative' }}>
          {colors?.map(({ id, color }) => (
            <div key={id} className="decoration-fade-in" style={{ position: 'absolute', inset: 0, backgroundColor: color }} />
          ))}
          <div className={pieceWrapClass} style={{ width: '100%', height: '100%', position: 'relative' }}>
            {children}
          </div>
          {currentNagGlyph?.square === square && (
            <span
              style={{
                position: 'absolute', top: 2, right: 2, zIndex: 20, pointerEvents: 'none',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '9999px', backgroundColor: 'rgba(0,0,0,0.75)',
              }}
            >
              <span className={`font-bold text-[11px] leading-none ${currentNagGlyph.nag.color}`}>{currentNagGlyph.nag.glyph}</span>
            </span>
          )}
        </div>
      );
    };
  }, [highlightsBySquare, activeAnimBySquare, currentNagGlyph]);

  const canPrev = game.current.parent !== null;
  const canNext = game.current.children.length > 0;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* ── Main layout: stacked on mobile, side-by-side on desktop ─────── */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">

        {/* Player row above, eval bar + board, player row below — lichess-mobile
            style. Board orientation decides which side rides on top. */}
        <div className="flex flex-col shrink-0" style={{ width: 'min(100vw, 90vh, 560px)', maxWidth: '100%' }}>
          <PlayerRow
            color={topColor}
            headers={game.headers}
            clock={topColor === 'w' ? clocks.white : clocks.black}
            active={sideToMoveColor === topColor}
            showEventDate
            onOpen={() => setShowGameInfo(true)}
          />
        {/* Outer wrapper has CSS-intrinsic dimensions so getBoundingClientRect()
            always returns a real value regardless of device or SSR state. */}
        <div
          className="flex gap-px lg:gap-1.5 items-start"
        >
          {showEngine && boardWidth > 0 && (
            <EvalBar
              score={barScore}
              mate={barMate}
              height={boardWidth}
            />
          )}
          <div
            ref={containerRef}
            className="flex-1 min-w-0 relative"
            data-board-container="true"
            style={{ aspectRatio: '1 / 1' }}
            onPointerDown={handleBoardPointerDown}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={handleBoardTouchStart}
            onTouchEnd={clearLongPress}
            onTouchMove={clearLongPress}
          >
            {boardWidth > 0 && <Chessboard
              position={game.currentFen}
              boardWidth={boardWidth}
              boardOrientation={game.flipped ? 'black' : 'white'}
              onSquareClick={handleSquareClick}
              onPieceDrop={handlePieceDrop}
              onPromotionCheck={handlePromotionCheck}
              onPromotionPieceSelect={handlePromotionSelect}
              promotionDialogVariant="modal"
              showPromotionDialog={pendingPromo !== null}
              promotionToSquare={pendingPromo?.to as CbSquare | undefined}
              areArrowsAllowed={false}
              customArrows={allArrows}
              customSquareStyles={squareStyles}
              customSquare={customSquare}
            />}

            {/* Armed-tool capture overlay: while drawing an arrow or dragging a
                zone selection, this intercepts every pointer event over the
                board so the chessboard underneath never sees them as a piece
                drag. */}
            {armed && (
              <div
                className="absolute inset-0 z-20 cursor-crosshair touch-none"
                onPointerDown={handleArmedPointerDown}
                onPointerMove={handleArmedPointerMove}
                onPointerUp={handleArmedPointerUp}
              />
            )}

            {/* Zone drag-to-select marquee — a rotated band matching the
                capsule selection (works for horizontal/vertical/diagonal
                drags alike), in a neutral gray independent of the highlight
                colour already chosen from the popup. */}
            {zoneDragStart && zoneDragEnd && (() => {
              const dx = zoneDragEnd.x - zoneDragStart.x;
              const dy = zoneDragEnd.y - zoneDragStart.y;
              const length = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx) * 180 / Math.PI;
              return (
                <div
                  className="fixed z-30 border-2 border-dashed border-gray-400 bg-gray-400/10 pointer-events-none"
                  style={{
                    left: zoneDragStart.x,
                    top: zoneDragStart.y - zoneDragStart.squareSize / 2,
                    width: length,
                    height: zoneDragStart.squareSize,
                    transformOrigin: 'left center',
                    transform: `rotate(${angle}deg)`,
                  }}
                />
              );
            })()}

            {/* Manual delete "×" for the focused decoration — click a
                decorated square/arrow to focus it, then click this to remove
                it. Replaces the old implicit "any click deletes the last
                decoration" behaviour, which made building up several
                arrows/zones fragile. */}
            {focused && focusedRect && (
              <button
                className="fixed z-40 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold leading-none flex items-center justify-center shadow"
                style={{ left: focusedRect.right - 10, top: focusedRect.top - 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  game.removeDecoration(focused.id);
                  setFocused(null);
                }}
                title="Delete decoration"
              >
                ×
              </button>
            )}

            {menu && (
              <DecorationMenu
                x={menu.x}
                y={menu.y}
                editing={menu.editing}
                onCommit={handleMenuCommit}
                onClose={() => setMenu(null)}
              />
            )}
          </div>
        </div>
          <PlayerRow
            color={bottomColor}
            headers={game.headers}
            clock={bottomColor === 'w' ? clocks.white : clocks.black}
            active={sideToMoveColor === bottomColor}
            showEventDate={false}
            onOpen={() => setShowGameInfo(true)}
          />
        </div>

        {/* Right panel */}
        <div
          className="w-full lg:flex-1 lg:min-w-[220px] bg-zinc-900 rounded-md flex flex-col lg:overflow-hidden"
          style={isDesktop && boardWidth > 0 ? { height: boardWidth } : undefined}
        >
          {/* Controls — edge to edge (prev/next touch the panel edges).
              On desktop they pin to the bottom of the panel (order-4). */}
          <div className="shrink-0 lg:order-4 lg:mt-1.5">
            <BoardControls
              onStart={game.goStart}
              onPrev={game.goPrev}
              onNext={game.goNext}
              onEnd={game.goEnd}
              onFlip={game.flipBoard}
              canPrev={canPrev}
              canNext={canNext}
              exportPgn={game.exportPgn}
              onNewGame={handleNewGame}
              onAddGameData={() => setShowGameInfo(true)}
              onSaveToLibrary={() => openLibrary('save')}
              onOpenLibrary={() => openLibrary('browse')}
              onSavePosition={() => setShowSavePosition(true)}
              isLoaded={!!loadedFromLibraryId}
              onPrevGame={() => loadAdjacent(-1)}
              onNextGame={() => loadAdjacent(1)}
              gameNavEnabled={!!loadedFromLibraryId && !!loadedFromFolderId}
              showEngine={showEngine}
              onToggleEngine={() => setShowEngine((v) => !v)}
            />
          </div>

          {/* Engine lines — hidden by default (toggle in the ··· menu); on
              desktop they sit just above the controls at the bottom of the
              panel (order-3); on mobile they follow the controls. */}
          {showEngine && (
          <div className="shrink-0 mt-1.5 lg:order-3 lg:mt-0">
            <EngineLines
              lines={engine.lines}
              depth={engine.depth}
              isComputing={engine.isComputing}
              enabled={engine.enabled}
              onToggle={engine.toggleEngine}
              currentFen={game.currentFen}
            />
          </div>
          )}

          {/* Moves list — capped height with its own scroll so it never grows
              unbounded on mobile; fills the remaining panel height on desktop. */}
          <div className="max-h-[45vh] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0 lg:order-2">
            <MovesList
              tokens={game.tokens}
              current={game.current}
              onSelect={game.goTo}
              onDeleteMove={game.deleteMove}
              onDeleteAfter={game.deleteAfter}
              comments={game.nodeComments}
              meta={game.nodeMeta}
              onSetComment={game.setNodeComment}
              nags={game.nags}
              onSetNags={game.setNodeNags}
              gameId={loadedFromLibraryId}
              timeFormat={gameFormat(game.headers)}
              timeIncrement={timeControlIncrement(game.headers)}
            />
          </div>
        </div>
      </div>

      {/* ── FEN / PGN bar ───────────────────────────────────────────────── */}
      <FenBar
        currentFen={game.currentFen}
        onFenLoad={handleFenLoad}
        onPgnLoad={handlePgnLoad}
        exportPgn={game.exportPgn}
      />

      {/* ── Game info modal ──────────────────────────────────────────────── */}
      {showGameInfo && (
        <GameInfoModal
          headers={game.headers}
          onSetHeader={game.setHeader}
          onClose={() => setShowGameInfo(false)}
        />
      )}

      {/* ── Save position to practice ────────────────────────────────────── */}
      {showSavePosition && (
        <SavePositionDialog
          input={{ fen: game.currentFen, side: sideToMove(game.currentFen), source: 'board' }}
          onClose={() => setShowSavePosition(false)}
        />
      )}

      {/* ── Library modal ────────────────────────────────────────────────── */}
      {showLibrary && (
        <LibraryModal
          mode={libraryMode}
          onSaveHere={handleSaveToLibrary}
          onLoad={handleLoadFromLibrary}
          onClose={() => setShowLibrary(false)}
          currentGameId={loadedFromLibraryId}
          currentFolderId={loadedFromFolderId}
        />
      )}

      {/* ── Unsaved prompt ───────────────────────────────────────────────── */}
      {showUnsavedPrompt && (
        <UnsavedPrompt
          onSave={() => {
            setShowUnsavedPrompt(false);
            setLibraryMode('save');
            setShowLibrary(true);
          }}
          onDiscard={() => {
            setShowUnsavedPrompt(false);
            if (pendingLoadRef.current) {
              doLoad(pendingLoadRef.current);
              pendingLoadRef.current = null;
            }
          }}
          onCancel={() => {
            setShowUnsavedPrompt(false);
            pendingLoadRef.current = null;
          }}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 bg-zinc-700 border border-zinc-600 rounded-full text-xs text-zinc-100 shadow-lg pointer-events-none">
          {toast}
        </div>
      )}

    </div>
  );
}
