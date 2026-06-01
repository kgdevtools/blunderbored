'use client';
import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';

// useLayoutEffect fires synchronously after DOM commit (before paint), so
// getBoundingClientRect always returns real values. Falls back to useEffect on
// the server where layout APIs are unavailable.
const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, Piece, PromotionPieceOption } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import type { Square, PieceSymbol } from 'chess.js';
import { useBoardGame } from '@/hooks/useBoardGame';
import { useBoardEngine } from '@/hooks/useBoardEngine';
import { EvalBar } from './EvalBar';
import { MovesList } from './MovesList';
import { EngineLines } from './EngineLines';
import { BoardControls } from './BoardControls';
import { FenBar } from './FenBar';
import { GameInfoModal } from './GameInfoModal';
import { LibraryModal } from './LibraryModal';
import { saveGame, updateGame, serializeBoardState, checkDuplicate } from '@/lib/library';
import type { LibraryGame } from '@/lib/db';

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

// ─── Game info header ─────────────────────────────────────────────────────────

function GameInfoHeader({
  headers,
  onOpen,
  onOpenLibrary,
  isLoaded,
}: {
  headers: Record<string, string>;
  onOpen: () => void;
  onOpenLibrary: () => void;
  isLoaded: boolean;
}) {
  const { White: white, Black: black, WhiteElo: wElo, BlackElo: bElo, Result: result, Event: event, Date: date } = headers;
  const hasPlayers = white || black;

  if (!hasPlayers) {
    return (
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onOpen}
          className="flex items-center gap-1.5 text-md text-zinc-500 hover:text-zinc-300 transition-colors py-0.5"
        >
          <PlusIcon />
          <span>Add Game Data</span>
        </button>
        <button
          onClick={onOpenLibrary}
          className={`flex items-center gap-1.5 text-xs transition-colors py-0.5 ml-auto
            ${isLoaded ? 'text-emerald-500 hover:text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <BookIcon />
          <span>{isLoaded ? 'Update Library' : 'Library'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full mb-2 rounded overflow-hidden border border-zinc-700/60 hover:border-zinc-600 transition-colors">
      {/* Player row */}
      <div className="flex items-stretch">
        {/* Clickable zone: white + result + black */}
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => e.key === 'Enter' && onOpen()}
          className="flex flex-1 items-stretch cursor-pointer min-w-0"
        >
          {/* White */}
          <div className="flex-1 min-w-0 bg-zinc-100 flex items-center gap-1.5 px-2.5 py-2.5">
            <span className="text-sm font-bold text-zinc-900 truncate">{white ?? '?'}</span>
            {wElo && <span className="text-xs text-zinc-500 tabular-nums shrink-0">{wElo}</span>}
          </div>

          {/* Result */}
          <div className="px-3 flex items-center justify-center bg-zinc-800 shrink-0">
            <span className="text-sm font-bold text-cyan-400 tabular-nums">{result ?? '–'}</span>
          </div>

          {/* Black */}
          <div className="flex-1 min-w-0 bg-zinc-950 flex items-center justify-end gap-1.5 px-2.5 py-2.5">
            {bElo && <span className="text-xs text-zinc-500 tabular-nums shrink-0">{bElo}</span>}
            <span className="text-sm font-bold text-zinc-100 truncate">{black ?? '?'}</span>
          </div>
        </div>

        {/* Library icon — standalone, stops propagation */}
        <button
          onClick={(e) => { e.stopPropagation(); onOpenLibrary(); }}
          className={`flex items-center justify-center px-3 bg-zinc-800 hover:bg-zinc-700 transition-colors shrink-0 border-l border-zinc-700/50
            ${isLoaded ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-700 hover:text-cyan-400'}`}
          title={isLoaded ? 'Update in Library' : 'Library'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </button>
      </div>

      {/* Event / Date row */}
      {(event || date) && (
        <div
          role="button"
          tabIndex={-1}
          onClick={onOpen}
          className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/40 border-t border-zinc-700/40 cursor-pointer"
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

  const initApplied = useRef(false);
  useEffect(() => {
    if (initApplied.current) return;
    initApplied.current = true;
    if (initialPgn) game.loadPgn(initialPgn);
    else if (initialFen) game.loadFen(initialFen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Library ────────────────────────────────────────────────────────────────
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryMode, setLibraryMode] = useState<'browse' | 'save'>('browse');
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [loadedFromLibraryId, setLoadedFromLibraryId] = useState<string | null>(null);
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
    );
    setLoadedFromLibraryId(libGame.id);
    setShowLibrary(false);
  }, [game]);

  const handleSaveToLibrary = useCallback(async (folderId: string) => {
    const payload = serializeBoardState(folderId, {
      exportPgn: game.exportPgn,
      headers: game.headers,
      nodeComments: game.nodeComments,
      allAnnotations: game.allAnnotations,
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
  const handlePgnLoad = useCallback((pgn: string) => {
    game.loadPgn(pgn);
    setLoadedFromLibraryId(null);
  }, [game]);

  const handleFenLoad = useCallback((fen: string) => {
    game.loadFen(fen);
    setLoadedFromLibraryId(null);
  }, [game]);

  // ── Click-to-move ──────────────────────────────────────────────────────────
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: Square; to: Square } | null>(null);

  useEffect(() => { setSelectedSq(null); }, [game.currentFen]);

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
      if (!selectedSq && game.hasAnnotations) {
        game.removeLastDecoration();
        return;
      }
      if (!selectedSq) {
        if (piece && pieceColor(piece) === mover) setSelectedSq(square);
        return;
      }
      if (legalDests.has(square)) {
        const moved = game.makeMove(selectedSq, square);
        setSelectedSq(moved ? null : selectedSq);
        return;
      }
      if (piece && pieceColor(piece) === mover) {
        setSelectedSq(square);
        return;
      }
      setSelectedSq(null);
    },
    [selectedSq, legalDests, mover, game],
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

  // ── Annotations: right-click detection ────────────────────────────────────
  const lastHoveredSq = useRef<string | null>(null);
  const rightDragStart = useRef<string | null>(null);

  useEffect(() => {
    const reset = () => { rightDragStart.current = null; };
    window.addEventListener('mouseup', reset);
    return () => window.removeEventListener('mouseup', reset);
  }, []);

  const handleMouseOverSquare = useCallback((sq: CbSquare) => {
    lastHoveredSq.current = sq as string;
  }, []);

  const handleSquareRightClick = useCallback(
    (sq: CbSquare) => {
      const start = rightDragStart.current;
      rightDragStart.current = null;
      if (!start || start === (sq as string)) {
        game.addHighlight(sq as string);
      } else {
        game.addArrow(start, sq as string);
      }
    },
    [game],
  );

  // ── Square styles ──────────────────────────────────────────────────────────
  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string | number>> = {};
    if (game.current.move) {
      const tint = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
      styles[game.current.move.from] = tint;
      styles[game.current.move.to] = tint;
    }
    for (const sq of game.annotationHighlights) {
      styles[sq] = { backgroundColor: 'rgba(255, 128, 0, 0.5)' };
    }
    if (selectedSq) {
      styles[selectedSq] = { backgroundColor: 'rgba(20, 85, 30, 0.5)' };
      legalDests.forEach((dest) => {
        styles[dest] = {
          background: 'radial-gradient(circle, rgba(0,0,0,0.2) 28%, transparent 28%)',
        };
      });
    }
    return styles;
  }, [game.current, game.annotationHighlights, selectedSq, legalDests]);

  // ── Arrows ─────────────────────────────────────────────────────────────────
  const allArrows = useMemo((): [CbSquare, CbSquare, string][] => {
    const userArrows = game.annotationArrows.map(
      ([from, to]) => [from as CbSquare, to as CbSquare, 'rgba(255,128,0,0.85)'] as [CbSquare, CbSquare, string],
    );
    const pv0 = engine.lines[0]?.pv[0];
    const engineArrow: [CbSquare, CbSquare, string][] =
      pv0 && pv0.length >= 4
        ? [[pv0.slice(0, 2) as CbSquare, pv0.slice(2, 4) as CbSquare, 'rgba(0,120,255,0.55)']]
        : [];
    return [...engineArrow, ...userArrows];
  }, [game.annotationArrows, engine.lines]);

  const canPrev = game.current.parent !== null;
  const canNext = game.current.children.length > 0;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* ── Main layout: stacked on mobile, side-by-side on desktop ─────── */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">

        {/* Eval bar + board */}
        {/* Outer wrapper has CSS-intrinsic dimensions so getBoundingClientRect()
            always returns a real value regardless of device or SSR state. */}
        <div
          className="flex gap-1.5 items-start shrink-0"
          style={{ width: 'min(90vw, 90vh, 560px)', maxWidth: '100%' }}
        >
          {boardWidth > 0 && (
            <EvalBar
              score={engine.evalScore}
              mate={engine.lines[0]?.mate}
              height={boardWidth}
            />
          )}
          <div
            ref={containerRef}
            className="flex-1 min-w-0"
            data-board-container="true"
            style={{ aspectRatio: '1 / 1' }}
            onMouseDown={(e) => {
              if (e.button === 2) rightDragStart.current = lastHoveredSq.current;
            }}
            onContextMenu={(e) => e.preventDefault()}
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
              onMouseOverSquare={handleMouseOverSquare}
              onSquareRightClick={handleSquareRightClick}
              customArrows={allArrows}
              customSquareStyles={squareStyles}
            />}
          </div>
        </div>

        {/* Right panel */}
        <div
          className="w-full lg:flex-1 lg:min-w-[220px] bg-zinc-900 rounded-md flex flex-col gap-2 lg:overflow-hidden"
          style={isDesktop && boardWidth > 0 ? { height: boardWidth } : undefined}
        >
          {/* Controls — first on mobile (order-1), last on desktop (order-3) */}
          <div className="order-1 lg:order-3 shrink-0">
            <BoardControls
              onStart={game.goStart}
              onPrev={game.goPrev}
              onNext={game.goNext}
              onEnd={game.goEnd}
              onFlip={game.flipBoard}
              canPrev={canPrev}
              canNext={canNext}
              exportPgn={game.exportPgn}
            />
          </div>

          {/* Moves list — second on mobile (order-2), first on desktop (order-1) */}
          <div className="order-2 lg:order-1 lg:flex-1 lg:overflow-y-auto lg:min-h-0 mx-2">
            <GameInfoHeader
              headers={game.headers}
              onOpen={() => setShowGameInfo(true)}
              onOpenLibrary={() => {
                setLibraryMode(loadedFromLibraryId ? 'save' : 'browse');
                setShowLibrary(true);
              }}
              isLoaded={!!loadedFromLibraryId}
            />
            <MovesList
              tokens={game.tokens}
              current={game.current}
              onSelect={game.goTo}
              onDeleteMove={game.deleteMove}
              onDeleteAfter={game.deleteAfter}
              comments={game.nodeComments}
              onSetComment={game.setNodeComment}
            />
          </div>

          {/* Engine lines — third on mobile (order-3), second on desktop (order-2) */}
          <div className="order-3 lg:order-2 shrink-0">
            <EngineLines
              lines={engine.lines}
              depth={engine.depth}
              isComputing={engine.isComputing}
              enabled={engine.enabled}
              onToggle={engine.toggleEngine}
              currentFen={game.currentFen}
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

      {/* ── Library modal ────────────────────────────────────────────────── */}
      {showLibrary && (
        <LibraryModal
          mode={libraryMode}
          onSaveHere={handleSaveToLibrary}
          onLoad={handleLoadFromLibrary}
          onClose={() => setShowLibrary(false)}
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
