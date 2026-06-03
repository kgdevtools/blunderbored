'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type FC } from 'react';

// useLayoutEffect fires synchronously after DOM commit (before paint), so
// getBoundingClientRect always returns real values. Falls back to useEffect on
// the server where layout APIs are unavailable.
const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { useRouter } from 'next/navigation';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, CustomSquareProps } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { useGameReviewer } from '@/hooks/useGameReviewer';
import { EvalBar } from '@/components/board/EvalBar';
import { QUALITY_META, type MoveQuality } from '@/lib/accuracy';
import { GameSummary } from './GameSummary';
import { ReviewMoveList } from './ReviewMoveList';
import { GameInfoModal } from '@/components/board/GameInfoModal';

// ── Icons ─────────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg className="inline-block shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg className="inline-block shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

const btn =
  'flex-1 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

interface ReviewerControlsProps {
  onStart:       () => void;
  onPrev:        () => void;
  onNext:        () => void;
  onEnd:         () => void;
  onFlip:        () => void;
  canPrev:       boolean;
  canNext:       boolean;
  onDownload:    () => void;
  onShowGameInfo: () => void;
  onOpenInBoard: () => void;
  canOpenInBoard: boolean;
}

function ReviewerControls({
  onStart, onPrev, onNext, onEnd, onFlip,
  canPrev, canNext, onDownload, onShowGameInfo, onOpenInBoard, canOpenInBoard,
}: ReviewerControlsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef    = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); onPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (e.key === 'Home')  { e.preventDefault(); onStart(); }
      else if (e.key === 'End')   { e.preventDefault(); onEnd(); }
      else if (e.key === 'f' || e.key === 'F') onFlip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStart, onPrev, onNext, onEnd, onFlip]);

  useEffect(() => {
    if (!showMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setShowMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showMenu]);

  return (
    <div className="relative flex gap-0.5 pt-2 border-t border-zinc-700 shrink-0">
      <button className={btn} onClick={onStart} disabled={!canPrev} title="Start (Home)">⟨⟨</button>
      <button className={btn} onClick={onPrev}  disabled={!canPrev} title="Previous (←)">⟨</button>
      <button className={btn} onClick={onNext}  disabled={!canNext} title="Next (→)">⟩</button>
      <button className={btn} onClick={onEnd}   disabled={!canNext} title="End (End)">⟩⟩</button>
      <button className={btn} onClick={onFlip}  title="Flip board (F)">⇅</button>
      <button
        ref={triggerRef}
        className="flex-none px-2 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors"
        onClick={() => setShowMenu(v => !v)}
        title="More options"
      >
        ···
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[180px] text-sm"
        >
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canOpenInBoard}
            title={canOpenInBoard ? undefined : 'Analyse a game first'}
            onClick={() => { onOpenInBoard(); setShowMenu(false); }}
          >
            <BoardIcon />
            Open in Board
          </button>
          <div className="my-1 border-t border-zinc-700" />
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={() => { onShowGameInfo(); setShowMenu(false); }}
          >
            Game Data
          </button>
          <div className="my-1 border-t border-zinc-700" />
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={() => { onDownload(); setShowMenu(false); }}
          >
            <DownloadIcon />
            Download PGN
          </button>
        </div>
      )}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>Analysing move {current} / {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

interface ReviewerShellProps {
  initialPgn?: string;
}

export function ReviewerShell({ initialPgn }: ReviewerShellProps) {
  const reviewer = useGameReviewer();
  const router = useRouter();
  const [pgnInput, setPgnInput] = useState(initialPgn ?? '');
  const [flipped, setFlipped]   = useState(false);
  const [showGameInfo, setShowGameInfo]   = useState(false);
  const [reviewComments, setReviewComments] = useState<Map<number, string>>(new Map());

  // Sync local headers from reviewer (allows editing in the modal)
  const [localHeaders, setLocalHeaders] = useState<Record<string, string>>({});
  useEffect(() => { setLocalHeaders(reviewer.headers); }, [reviewer.headers]);
  const handleSetHeader = useCallback((key: string, value: string) => {
    setLocalHeaders(prev => value ? { ...prev, [key]: value } : (({ [key]: _, ...rest }) => rest)(prev));
  }, []);

  const handleSetReviewComment = useCallback((moveIndex: number, text: string) => {
    setReviewComments(prev => {
      const next = new Map(prev);
      if (text.trim()) next.set(moveIndex, text.trim());
      else next.delete(moveIndex);
      return next;
    });
  }, []);

  // Reset comments on new analysis
  useEffect(() => {
    if (reviewer.review) setReviewComments(new Map());
  }, [reviewer.review]);

  const initApplied = useRef(false);
  useEffect(() => {
    if (initApplied.current) return;
    initApplied.current = true;
    if (initialPgn) reviewer.loadPgn(initialPgn);
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

  // ── Board width (measured from container, no circular dependency) ──────────
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
    // Fallback for browsers without ResizeObserver
    const onResize = () => apply(el.getBoundingClientRect().width || Math.min(window.innerWidth * 0.9, window.innerHeight * 0.9, 560));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Last-move highlight ────────────────────────────────────────────────────
  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    const m = reviewer.currentMove;
    if (!m) return styles;
    try {
      const chess = new Chess(m.fenBefore);
      const move = chess.move(m.moveSan);
      if (move) {
        const tint = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
        styles[move.from] = tint;
        styles[move.to]   = tint;
      }
    } catch { /* ignore */ }
    return styles;
  }, [reviewer.currentMove?.fenBefore, reviewer.currentMove?.moveSan]);

  // ── Best-move arrow ────────────────────────────────────────────────────────
  const arrows = useMemo((): [CbSquare, CbSquare, string][] => {
    const uci = reviewer.currentMove?.bestMoveUci;
    if (!uci || uci.length < 4) return [];
    return [[uci.slice(0, 2) as CbSquare, uci.slice(2, 4) as CbSquare, 'rgba(0,120,255,0.55)']];
  }, [reviewer.currentMove?.bestMoveUci]);

  // ── Quality glyph badge (custom square renderer) ───────────────────────────
  const glyphSquare = useMemo(() => {
    const m = reviewer.currentMove;
    if (!m || m.quality === 'book') return null;
    try {
      const chess = new Chess(m.fenBefore);
      const move = chess.move(m.moveSan);
      return move ? { square: move.to, quality: m.quality } : null;
    } catch { return null; }
  }, [reviewer.currentMove?.fenBefore, reviewer.currentMove?.moveSan, reviewer.currentMove?.quality]);

  const customSquare: FC<CustomSquareProps> | undefined = useMemo(() => {
    if (!glyphSquare) return undefined;
    const { square: glyphSq, quality } = glyphSquare;
    const meta = QUALITY_META[quality as MoveQuality];
    return function GlyphSquare({ children, ref, square, style }: CustomSquareProps) {
      return (
        <div ref={ref} style={{ ...style, position: 'relative' }}>
          {children}
          {square === glyphSq && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                color: meta.hex,
                textShadow: '0 0 3px rgba(0,0,0,0.9)',
                pointerEvents: 'none',
                zIndex: 20,
                userSelect: 'none',
              }}
            >
              {meta.symbol}
            </span>
          )}
        </div>
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyphSquare?.square, glyphSquare?.quality]);

  // ── Nav state ──────────────────────────────────────────────────────────────
  const canPrev = reviewer.currentMoveIndex >= 0;
  const canNext = reviewer.review !== null && reviewer.currentMoveIndex < reviewer.review.moves.length - 1;

  // ── Download PGN ───────────────────────────────────────────────────────────
  const handleDownload = () => {
    const pgn = reviewer.originalPgn;
    if (!pgn) return;
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'game.pgn';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Open the analysed game on the full Board ────────────────────────────────
  const handleOpenInBoard = () => {
    const pgn = reviewer.originalPgn;
    if (!pgn) return;
    router.push(`/board?pgn=${encodeURIComponent(pgn)}`);
  };

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
          {boardWidth > 0 && <EvalBar score={reviewer.currentEval} height={boardWidth} />}
          <div
            ref={containerRef}
            className="flex-1 min-w-0"
            data-board-container="true"
            style={{ aspectRatio: '1 / 1' }}
          >
            {boardWidth > 0 && (
              <Chessboard
                position={reviewer.currentFen}
                boardWidth={boardWidth}
                boardOrientation={flipped ? 'black' : 'white'}
                arePiecesDraggable={false}
                customArrows={arrows}
                customSquareStyles={squareStyles}
                customSquare={customSquare}
              />
            )}
          </div>
        </div>

        {/* Right panel */}
        <div
          className="w-full lg:flex-1 lg:min-w-[220px] bg-zinc-900 rounded-md p-3 flex flex-col gap-2 lg:overflow-hidden"
          style={isDesktop && boardWidth > 0 ? { height: boardWidth } : undefined}
        >
          {/* Controls — first on mobile (order-1), last on desktop (order-3) */}
          <div className="order-1 lg:order-3 shrink-0">
            <ReviewerControls
              onStart={reviewer.goToStart}
              onPrev={reviewer.goBack}
              onNext={reviewer.goForward}
              onEnd={reviewer.goToEnd}
              onFlip={() => setFlipped(f => !f)}
              canPrev={canPrev}
              canNext={canNext}
              onDownload={handleDownload}
              onShowGameInfo={() => setShowGameInfo(true)}
              onOpenInBoard={handleOpenInBoard}
              canOpenInBoard={!!reviewer.originalPgn}
            />
          </div>

          {/* Moves list — second on mobile (order-2), first on desktop (order-1) */}
          <div className="order-2 lg:order-1 lg:flex-1 lg:overflow-y-auto lg:min-h-0">
            {reviewer.review && <GameSummary review={reviewer.review} />}
            {reviewer.error && (
              <div className="mx-1 my-2 px-2 py-2 rounded bg-red-900/40 border border-red-700 text-xs text-red-300">
                {reviewer.error}
              </div>
            )}
            {reviewer.isLoading ? (
              <div className="py-4 px-1">
                <ProgressBar
                  current={reviewer.progress.current}
                  total={reviewer.progress.total}
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Stockfish 18 Lite — depth 14
                </p>
              </div>
            ) : reviewer.review ? (
              <ReviewMoveList
                moves={reviewer.review.moves}
                currentMoveIndex={reviewer.currentMoveIndex}
                onSelectMove={reviewer.goToMove}
                comments={reviewComments}
                onSetComment={handleSetReviewComment}
              />
            ) : (
              <p className="text-zinc-500 text-xs px-1 py-2">
                Paste a PGN below and click Analyse.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Game info modal ──────────────────────────────────────────────── */}
      {showGameInfo && (
        <GameInfoModal
          headers={localHeaders}
          onSetHeader={handleSetHeader}
          onClose={() => setShowGameInfo(false)}
        />
      )}

      {/* ── PGN input ───────────────────────────────────────────────────── */}
      <div className="flex gap-2 items-start">
        <textarea
          className="flex-1 p-2 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
          rows={3}
          placeholder="Paste PGN here…"
          value={pgnInput}
          onChange={e => setPgnInput(e.target.value)}
          spellCheck={false}
        />
        <button
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors whitespace-nowrap"
          onClick={() => { if (pgnInput.trim()) reviewer.loadPgn(pgnInput.trim()); }}
          disabled={reviewer.isLoading || !pgnInput.trim()}
        >
          {reviewer.isLoading ? 'Analysing…' : 'Analyse'}
        </button>
      </div>

    </div>
  );
}
