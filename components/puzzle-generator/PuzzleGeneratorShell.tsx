'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';

// useLayoutEffect fires synchronously after DOM commit (before paint), so
// getBoundingClientRect always returns real values. Falls back to useEffect on
// the server where layout APIs are unavailable.
const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { useGameReviewer } from '@/hooks/useGameReviewer';
import { useQualityGlyphSquare } from '@/hooks/useQualityGlyphSquare';
import { PASS1_DEPTH, PASS2_DEPTH, PASS2_MULTIPV, type ReviewedMove } from '@/lib/analysis';
import { EvalBar } from '@/components/board/EvalBar';
import { buildEnrichedPgn } from '@/lib/reviewToBoardPgn';
import { AnalysisModal } from '@/components/analysis/AnalysisModal';
import { GameSummary } from '@/components/analysis/GameSummary';
import { ReportModal } from '@/components/graph/ReportModal';
import { GameInfoModal } from '@/components/board/GameInfoModal';
import { PuzzleMoveList } from './PuzzleMoveList';
import { PuzzleBatchModal } from './PuzzleBatchModal';
import { buildDraftPuzzle, playedMoveUci } from '@/lib/puzzleSolution';
import { DevConsole } from '@/components/dev/DevConsole';
import { devlog } from '@/lib/devlog';
import { db, type Puzzle } from '@/lib/db';

// ── Nav controls — mirrors the board/game-reviewer BoardControls row:
// ⟨⟨ ⟨ ▶ ⟩ ⟩⟩ ⇅ with a 1s replay, same styling. Report/Open in Board/Generate
// Puzzles/Game Data/Download all live in the "···" menu so the row itself
// stays short enough for mobile. ────────────────────────────────────────────

const btn =
  'flex-1 py-1.5 rounded-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

function PlayIcon() {
  return (
    <svg className="inline-block shrink-0" width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg className="inline-block shrink-0" width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="inline-block shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

interface PuzzleNavControlsProps {
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnd: () => void;
  onFlip: () => void;
  canPrev: boolean;
  canNext: boolean;
  onOpenInBoard: () => void;
  canOpenInBoard: boolean;
  onOpenReport: () => void;
  canOpenReport: boolean;
  onShowGameInfo: () => void;
  onDownload: () => void;
  onToggleGenerate: () => void;
  puzzleMode: boolean;
  canGenerate: boolean;
}

function PuzzleNavControls({
  onStart, onPrev, onNext, onEnd, onFlip, canPrev, canNext, onOpenInBoard, canOpenInBoard,
  onOpenReport, canOpenReport, onShowGameInfo, onDownload, onToggleGenerate, puzzleMode, canGenerate,
}: PuzzleNavControlsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (menuTriggerRef.current?.contains(e.target as Node)) return;
      setShowMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showMenu]);

  // Replay (auto-advance), same ref pattern as BoardControls: the interval
  // reads the latest handlers through refs so it survives re-renders.
  const [isPlaying, setIsPlaying] = useState(false);
  const onNextRef = useRef(onNext);
  const canNextRef = useRef(canNext);
  useEffect(() => { onNextRef.current = onNext; canNextRef.current = canNext; });

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!canNextRef.current) { setIsPlaying(false); return; }
      onNextRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

  const toggleReplay = () => {
    if (isPlaying) { setIsPlaying(false); return; }
    if (!canNext) onStart();
    setIsPlaying(true);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (e.key === 'Home') { e.preventDefault(); onStart(); }
      else if (e.key === 'End') { e.preventDefault(); onEnd(); }
      else if (e.key === 'f' || e.key === 'F') onFlip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStart, onPrev, onNext, onEnd, onFlip]);

  return (
    <div className="relative flex gap-0.5 pt-2 border-t border-zinc-700 shrink-0">
      <button className={btn} onClick={onStart} disabled={!canPrev} title="Start (Home)">⟨⟨</button>
      <button className={btn} onClick={onPrev} disabled={!canPrev} title="Previous (←)">⟨</button>
      <button
        className={`${btn} grid place-items-center`}
        onClick={toggleReplay}
        disabled={!canNext && !canPrev}
        title={isPlaying ? 'Pause replay' : 'Replay (1s/move)'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button className={btn} onClick={onNext} disabled={!canNext} title="Next (→)">⟩</button>
      <button className={btn} onClick={onEnd} disabled={!canNext} title="End (End)">⟩⟩</button>
      <button className={btn} onClick={onFlip} title="Flip board (F)">⇅</button>
      <button
        ref={menuTriggerRef}
        className="flex-none px-2 py-1.5 rounded-sm bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors"
        onClick={() => setShowMenu((v) => !v)}
        title="More options"
      >
        ···
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[190px] text-sm"
        >
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canGenerate}
            onClick={() => { onToggleGenerate(); setShowMenu(false); }}
          >
            {puzzleMode ? 'Exit Puzzle Mode' : 'Generate Puzzles'}
          </button>
          <div className="my-1 border-t border-zinc-700" />
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canOpenReport}
            onClick={() => { onOpenReport(); setShowMenu(false); }}
          >
            Report
          </button>
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canOpenInBoard}
            title={canOpenInBoard ? undefined : 'Analyse a game first'}
            onClick={() => { onOpenInBoard(); setShowMenu(false); }}
          >
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

// ── Shell ─────────────────────────────────────────────────────────────────────

interface PuzzleGeneratorShellProps {
  initialPgn?: string;
}

export function PuzzleGeneratorShell({ initialPgn }: PuzzleGeneratorShellProps) {
  const reviewer = useGameReviewer();
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [hideAnalysisModal, setHideAnalysisModal] = useState(false);
  useEffect(() => { if (reviewer.isLoading) setHideAnalysisModal(false); }, [reviewer.isLoading]);

  // Report + Game Data (ported from the retired Game Reviewer page).
  const [showReport, setShowReport] = useState(false);
  const [showGameInfo, setShowGameInfo] = useState(false);
  const [localHeaders, setLocalHeaders] = useState<Record<string, string>>({});
  const [seenHeaders, setSeenHeaders] = useState(reviewer.headers);
  if (reviewer.headers !== seenHeaders) {
    setSeenHeaders(reviewer.headers);
    setLocalHeaders(reviewer.headers);
  }
  const handleSetHeader = useCallback((key: string, value: string) => {
    setLocalHeaders((prev) => value ? { ...prev, [key]: value } : (({ [key]: _, ...rest }) => rest)(prev));
  }, []);

  // ── Puzzle mode: highlight flagged moves; tap one to see the engine's
  // variation(s) and add any of them to the working draft set. ──────────────
  const [puzzleMode, setPuzzleMode] = useState(false);
  const [expandedMoveIndex, setExpandedMoveIndex] = useState<number | null>(null);
  const [draftMap, setDraftMap] = useState<Map<string, Puzzle>>(new Map());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // New analysis lands (or puzzle mode turns off) → close the report and
  // reset puzzle-picking state, adjusted during render rather than an effect.
  const [seenReview, setSeenReview] = useState(reviewer.review);
  if (reviewer.review !== seenReview) {
    setSeenReview(reviewer.review);
    setShowReport(false);
    setPuzzleMode(false);
    setExpandedMoveIndex(null);
    setDraftMap(new Map());
  }

  // Standalone PGN input — lets Game Analysis be used without being launched
  // from the Board.
  const [pgnInput, setPgnInput] = useState(initialPgn ?? '');

  const initApplied = useRef(false);
  useEffect(() => {
    if (initApplied.current) return;
    initApplied.current = true;
    if (initialPgn) reviewer.loadPgn(initialPgn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Forward the engine-analysis run log into the shared dev console, so one
  // place shows the whole pipeline in order.
  const forwardedLogCount = useRef(0);
  useEffect(() => {
    if (reviewer.logs.length < forwardedLogCount.current) forwardedLogCount.current = 0;
    for (let i = forwardedLogCount.current; i < reviewer.logs.length; i++) {
      const l = reviewer.logs[i];
      devlog('analysis', l.msg, { level: l.level, ts: l.ts });
    }
    forwardedLogCount.current = reviewer.logs.length;
  }, [reviewer.logs]);

  useEffect(() => {
    if (reviewer.review) {
      devlog('review', 'game analysed', {
        moves: reviewer.review.moves.length,
        opening: reviewer.review.opening?.name,
      });
    }
  }, [reviewer.review]);

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
  // The container only exists once reviewer.originalPgn is set (the PGN-input
  // screen below renders instead until then), and that flips one tick after
  // mount — so this must re-run when it flips, not just once on mount, or
  // containerRef.current is null on the only run and boardWidth stays 0 forever.
  const hasGame = !!reviewer.originalPgn;
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
  }, [hasGame]);

  // ── Live analysis replay: while the engine works, the board replays each
  // analysed move as its result lands (position + glyph + best-move arrow). ──
  const liveMove = reviewer.isLoading
    ? reviewer.moveEvents[reviewer.moveEvents.length - 1] ?? null
    : null;
  const shownMove = liveMove
    ? { fenBefore: liveMove.fenBefore, moveSan: liveMove.san, quality: liveMove.quality }
    : reviewer.currentMove;

  // ── Puzzle-mode preview: inspecting a move's variation shows that
  // (hypothetical, off-the-game-line) position on the board instead of the
  // game's current move, until another move/variation is picked. ──────────
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [previewLastMove, setPreviewLastMove] = useState<{ from: string; to: string } | null>(null);
  const clearPreview = useCallback(() => { setPreviewFen(null); setPreviewLastMove(null); }, []);
  const handlePreviewPosition = useCallback((fen: string, lastMove: { from: string; to: string } | null) => {
    setPreviewFen(fen);
    setPreviewLastMove(lastMove);
  }, []);

  const boardFen = liveMove ? liveMove.fenAfter : (previewFen ?? reviewer.currentFen);
  const barEval = liveMove ? liveMove.evalAfterCp : reviewer.currentEval;

  // ── Last-move highlight ────────────────────────────────────────────────────
  const isLive = !!liveMove;
  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (!isLive && previewFen) {
      if (previewLastMove) {
        const tint = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
        styles[previewLastMove.from] = tint;
        styles[previewLastMove.to] = tint;
      }
      return styles;
    }
    const m = shownMove;
    if (!m) return styles;
    try {
      const chess = new Chess(m.fenBefore);
      const move = chess.move(m.moveSan);
      if (move) {
        const tint = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
        styles[move.from] = tint;
        styles[move.to] = tint;
      }
    } catch { /* ignore */ }
    return styles;
  }, [shownMove?.fenBefore, shownMove?.moveSan, isLive, previewFen, previewLastMove]);

  // ── Best-move arrow while the live analysis replay runs. ──────────────────
  const arrows = useMemo((): [CbSquare, CbSquare, string][] => {
    if (liveMove?.bestUci && liveMove.bestUci.length >= 4) {
      return [[liveMove.bestUci.slice(0, 2) as CbSquare, liveMove.bestUci.slice(2, 4) as CbSquare, 'rgba(0,120,255,0.55)']];
    }
    return [];
  }, [liveMove?.bestUci]);

  const customSquare = useQualityGlyphSquare(previewFen ? null : (shownMove ?? null));

  const handleSelectGameMove = useCallback((index: number) => {
    clearPreview();
    reviewer.goToMove(index);
  }, [reviewer, clearPreview]);

  const handleToggleExpand = useCallback((move: ReviewedMove) => {
    setExpandedMoveIndex((cur) => {
      const next = cur === move.moveIndex ? null : move.moveIndex;
      if (next !== null) {
        // Show the position to solve from, with the opponent's move that
        // created it highlighted — same "what just happened" convention as
        // Solve mode.
        const prev = reviewer.review?.moves[move.moveIndex - 1];
        const prevUci = prev ? playedMoveUci(prev.fenBefore, prev.moveSan) : undefined;
        handlePreviewPosition(move.fenBefore, prevUci ? { from: prevUci.slice(0, 2), to: prevUci.slice(2, 4) } : null);
      }
      return next;
    });
  }, [reviewer.review, handlePreviewPosition]);

  const draftedKeys = useMemo(() => new Set(draftMap.keys()), [draftMap]);

  const handleToggleDraft = useCallback((move: ReviewedMove, variantIndex: 0 | 1, checked: boolean) => {
    const key = `${move.moveIndex}:${variantIndex}`;
    setDraftMap((prev) => {
      const next = new Map(prev);
      if (checked) {
        const moves = reviewer.review?.moves;
        const draft = moves ? buildDraftPuzzle(moves, move, variantIndex) : null;
        if (draft) next.set(key, draft);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, [reviewer.review]);

  const draftPuzzles = useMemo(() => [...draftMap.values()], [draftMap]);

  const handleRemoveDraft = useCallback((id: string) => {
    setDraftMap((prev) => {
      const next = new Map(prev);
      for (const [key, p] of next) if (p.id === id) next.delete(key);
      return next;
    });
  }, []);

  const handleSaveBatch = useCallback(async (name: string, finalPuzzles: Puzzle[]) => {
    const trimmed = name.trim() || `Workout — ${new Date().toLocaleDateString()}`;
    await db.puzzles.bulkAdd(finalPuzzles);
    await db.leitnerBoxes.bulkAdd(finalPuzzles.map((p) => ({
      puzzleId: p.id, box: 0, lastSessionNum: 0, rightCount: 0, wrongCount: 0,
    })));
    await db.workoutSets.add({
      id: nanoid(),
      name: trimmed,
      puzzleIds: finalPuzzles.map((p) => p.id),
      createdAt: Date.now(),
    });
    setDraftMap(new Map());
    setShowBatchModal(false);
    setPuzzleMode(false);
    setExpandedMoveIndex(null);
    clearPreview();
    setSavedMsg(`Saved "${trimmed}" — find it under Library → Workouts.`);
    setTimeout(() => setSavedMsg(null), 5000);
  }, [clearPreview]);

  // ── Nav state ──────────────────────────────────────────────────────────────
  const canPrev = reviewer.currentMoveIndex >= 0;
  const canNext = reviewer.review !== null && reviewer.currentMoveIndex < reviewer.review.moves.length - 1;

  const handleOpenInBoard = () => {
    const pgn = reviewer.originalPgn;
    if (!pgn) return;
    const review = reviewer.review;
    const goRaw = () => router.push(`/board?pgn=${encodeURIComponent(pgn)}`);
    if (!review) { goRaw(); return; }
    try {
      const enriched = buildEnrichedPgn(pgn, review, localHeaders);
      router.push(`/board?pgn=${encodeURIComponent(enriched)}`);
    } catch {
      goRaw();
    }
  };

  const handleDownload = () => {
    const pgn = reviewer.originalPgn;
    if (!pgn) return;
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'game.pgn';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!reviewer.originalPgn) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-3">
        <p className="text-sm text-zinc-400 text-center">
          Paste a PGN below, or open a game on the <Link href="/board" className="text-blue-400 underline">board</Link> and
          use &ldquo;Send to Game Analysis&rdquo; from its menu.
        </p>
        <div className="flex gap-2 items-start">
          <textarea
            className="flex-1 p-2 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
            rows={4}
            placeholder="Paste PGN here…"
            value={pgnInput}
            onChange={(e) => setPgnInput(e.target.value)}
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
        <DevConsole />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
        {/* Eval bar + board */}
        <div
          className="flex gap-px lg:gap-1.5 items-start shrink-0"
          style={{ width: 'min(100vw, 90vh, 560px)', maxWidth: '100%' }}
        >
          {boardWidth > 0 && <EvalBar score={barEval} height={boardWidth} />}
          <div
            ref={containerRef}
            className="flex-1 min-w-0"
            data-board-container="true"
            style={{ aspectRatio: '1 / 1' }}
          >
            {boardWidth > 0 && (
              <Chessboard
                position={boardFen}
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
          <div className="order-1 lg:order-3 shrink-0">
            <PuzzleNavControls
              onStart={reviewer.goToStart}
              onPrev={reviewer.goBack}
              onNext={reviewer.goForward}
              onEnd={reviewer.goToEnd}
              onFlip={() => setFlipped((f) => !f)}
              canPrev={canPrev}
              canNext={canNext}
              onOpenInBoard={handleOpenInBoard}
              canOpenInBoard={!!reviewer.originalPgn}
              onOpenReport={() => setShowReport(true)}
              canOpenReport={!!reviewer.review}
              onShowGameInfo={() => setShowGameInfo(true)}
              onDownload={handleDownload}
              onToggleGenerate={() => {
                setPuzzleMode((v) => !v);
                setExpandedMoveIndex(null);
                clearPreview();
              }}
              puzzleMode={puzzleMode}
              canGenerate={!!reviewer.review}
            />
          </div>

          {/* Confirm bar — visible whenever there's a draft to review, placed
              OUTSIDE the scrollable move list so it never scrolls out of view. */}
          {draftPuzzles.length > 0 && (
            <div className="order-2 lg:order-1 shrink-0 px-1">
              <button
                onClick={() => setShowBatchModal(true)}
                className="w-full px-3 py-2 rounded text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                Confirm ({draftPuzzles.length})
              </button>
              {savedMsg && <p className="text-xs text-emerald-400 mt-1">{savedMsg}</p>}
            </div>
          )}
          {draftPuzzles.length === 0 && savedMsg && (
            <div className="order-2 lg:order-1 shrink-0 px-1">
              <p className="text-xs text-emerald-400">{savedMsg}</p>
            </div>
          )}

          <div className="order-3 lg:order-2 max-h-[45vh] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
            {reviewer.review && reviewer.fromStore && (
              <div className="mx-1 mb-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                <span>Loaded saved review from library</span>
                <button
                  onClick={() => reviewer.reanalyse()}
                  className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  title="Run a fresh engine analysis and overwrite the saved review"
                >
                  Re-analyse
                </button>
              </div>
            )}
            {reviewer.review && <GameSummary review={reviewer.review} />}
            {reviewer.error && (
              <div className="mx-1 my-2 px-2 py-2 rounded bg-red-900/40 border border-red-700 text-xs text-red-300">
                {reviewer.error}
              </div>
            )}

            {reviewer.isLoading ? (
              <div className="py-4 px-1">
                <p className="text-xs text-zinc-400">
                  Analysing… {reviewer.progress.phase} {reviewer.progress.current}/{reviewer.progress.total}
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  Stockfish 18 Lite — scan d{PASS1_DEPTH}, deep d{PASS2_DEPTH}×{PASS2_MULTIPV}pv
                </p>
                {hideAnalysisModal && (
                  <button
                    onClick={() => setHideAnalysisModal(false)}
                    className="mt-2 text-[11px] text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                  >
                    Show analysis log
                  </button>
                )}
              </div>
            ) : reviewer.review ? (
              <PuzzleMoveList
                moves={reviewer.review.moves}
                currentMoveIndex={reviewer.currentMoveIndex}
                onSelectMove={handleSelectGameMove}
                puzzleMode={puzzleMode}
                expandedMoveIndex={expandedMoveIndex}
                onToggleExpand={handleToggleExpand}
                draftedKeys={draftedKeys}
                onToggleDraft={handleToggleDraft}
                onPreview={handlePreviewPosition}
              />
            ) : (
              <p className="text-zinc-500 text-xs px-1 py-2">Loading game…</p>
            )}
          </div>
        </div>
      </div>

      {reviewer.isLoading && !hideAnalysisModal && (
        <AnalysisModal
          progress={reviewer.progress}
          logs={reviewer.logs}
          moveEvents={reviewer.moveEvents}
          startedAt={reviewer.analysisStartedAt}
          onHide={() => setHideAnalysisModal(true)}
        />
      )}

      {showReport && reviewer.review && (
        <ReportModal
          review={reviewer.review}
          originalPgn={reviewer.originalPgn ?? ''}
          currentMoveIndex={reviewer.currentMoveIndex}
          onSelectMove={handleSelectGameMove}
          onClose={() => setShowReport(false)}
        />
      )}

      {showGameInfo && (
        <GameInfoModal
          headers={localHeaders}
          onSetHeader={handleSetHeader}
          onClose={() => setShowGameInfo(false)}
        />
      )}

      {showBatchModal && (
        <PuzzleBatchModal
          puzzles={draftPuzzles}
          onPreview={handlePreviewPosition}
          onRemove={handleRemoveDraft}
          onClose={() => setShowBatchModal(false)}
          onSave={handleSaveBatch}
        />
      )}

      <div className="flex gap-2 items-start">
        <textarea
          className="flex-1 p-2 rounded bg-zinc-800 border border-zinc-700 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
          rows={3}
          placeholder="Paste PGN here…"
          value={pgnInput}
          onChange={(e) => setPgnInput(e.target.value)}
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

      <DevConsole />
    </div>
  );
}
