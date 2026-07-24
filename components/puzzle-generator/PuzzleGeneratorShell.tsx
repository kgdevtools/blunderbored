'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';

// useLayoutEffect fires synchronously after DOM commit (before paint), so
// getBoundingClientRect always returns real values. Falls back to useEffect on
// the server where layout APIs are unavailable.
const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { useGameReviewer } from '@/hooks/useGameReviewer';
import { useQualityGlyphSquare } from '@/hooks/useQualityGlyphSquare';
import { PASS1_DEPTH, PASS2_DEPTH, PASS2_MULTIPV } from '@/lib/analysis';
import { EvalBar } from '@/components/board/EvalBar';
import { buildEnrichedPgn } from '@/lib/reviewToBoardPgn';
import { AnalysisModal } from '@/components/game-reviewer/AnalysisModal';
import { GameSummary } from '@/components/game-reviewer/GameSummary';
import { PuzzleMoveList } from './PuzzleMoveList';
import { DevConsole } from '@/components/dev/DevConsole';
import { devlog } from '@/lib/devlog';
import { generatePuzzlesFromReview, type BlunderSeverityFilter, type GeneratePuzzlesResult } from '@/lib/tacticsGenerator';
import type { Puzzle } from '@/lib/db';

const SEVERITY_OPTIONS: { value: BlunderSeverityFilter; label: string }[] = [
  { value: 'blunder-only', label: 'Blunders only' },
  { value: 'mistake-and-blunder', label: 'Mistakes + blunders' },
  { value: 'all-flagged', label: 'All flagged moves (incl. inaccuracies/misses)' },
];

// ── Nav controls (Start/Prev/Next/End/Flip + Open in Board) ───────────────────

const btn =
  'flex-1 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

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
}

function PuzzleNavControls({
  onStart, onPrev, onNext, onEnd, onFlip, canPrev, canNext, onOpenInBoard, canOpenInBoard,
}: PuzzleNavControlsProps) {
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
    <div className="flex gap-0.5 pt-2 border-t border-zinc-700 shrink-0">
      <button className={btn} onClick={onStart} disabled={!canPrev} title="Start (Home)">⟨⟨</button>
      <button className={btn} onClick={onPrev} disabled={!canPrev} title="Previous (←)">⟨</button>
      <button className={btn} onClick={onNext} disabled={!canNext} title="Next (→)">⟩</button>
      <button className={btn} onClick={onEnd} disabled={!canNext} title="End (End)">⟩⟩</button>
      <button className={btn} onClick={onFlip} title="Flip board (F)">⇅</button>
      <button
        className="flex-none px-2.5 py-1.5 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
        onClick={onOpenInBoard}
        disabled={!canOpenInBoard}
        title={canOpenInBoard ? 'Open the analysed game in the full board' : 'Analyse a game first'}
      >
        Open in Board
      </button>
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

  const [severity, setSeverity] = useState<BlunderSeverityFilter>('mistake-and-blunder');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratePuzzlesResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);

  const initApplied = useRef(false);
  useEffect(() => {
    if (initApplied.current) return;
    initApplied.current = true;
    if (initialPgn) reviewer.loadPgn(initialPgn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Forward the engine-analysis run log into the shared dev console, so one
  // place shows the whole pipeline (analysis + puzzle extraction) in order.
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
        styles[move.to] = tint;
      }
    } catch { /* ignore */ }
    return styles;
  }, [reviewer.currentMove?.fenBefore, reviewer.currentMove?.moveSan]);

  // ── Puzzle bookkeeping ──────────────────────────────────────────────────────
  const puzzlesByMoveIndex = useMemo(() => {
    const map = new Map<number, Puzzle[]>();
    if (!result) return map;
    for (const p of result.puzzles) {
      if (typeof p.sourcePly !== 'number') continue;
      const list = map.get(p.sourcePly) ?? [];
      list.push(p);
      map.set(p.sourcePly, list);
    }
    return map;
  }, [result]);

  const selectedPuzzle = useMemo(
    () => result?.puzzles.find((p) => p.id === selectedPuzzleId) ?? null,
    [result, selectedPuzzleId],
  );

  // ── Solution arrow for the selected puzzle (green — distinct from the
  // reviewer's own blue best-move arrow elsewhere in the app) ────────────────
  const arrows = useMemo((): [CbSquare, CbSquare, string][] => {
    const uci = selectedPuzzle?.solutionUci;
    if (!uci || uci.length < 4) return [];
    return [[uci.slice(0, 2) as CbSquare, uci.slice(2, 4) as CbSquare, 'rgba(0,200,0,0.65)']];
  }, [selectedPuzzle?.solutionUci]);

  const customSquare = useQualityGlyphSquare(reviewer.currentMove);

  const handleSelectPuzzle = useCallback((puzzle: Puzzle) => {
    if (puzzle.sourcePly == null) return;
    setSelectedPuzzleId(puzzle.id);
    reviewer.goToMove(puzzle.kind === 'avoid-blunder' ? puzzle.sourcePly - 1 : puzzle.sourcePly);
  }, [reviewer]);

  const handleGenerate = async () => {
    if (!reviewer.review) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);
    setSelectedPuzzleId(null);
    try {
      setResult(await generatePuzzlesFromReview(reviewer.review, { severity, sourceGameId: undefined }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate puzzles');
    } finally {
      setGenerating(false);
    }
  };

  // ── Nav state ──────────────────────────────────────────────────────────────
  const canPrev = reviewer.currentMoveIndex >= 0;
  const canNext = reviewer.review !== null && reviewer.currentMoveIndex < reviewer.review.moves.length - 1;

  // ── Open the analysed game on the full Board (same enrichment as Game
  // Reviewer, no extra per-move comments here) ───────────────────────────────
  const handleOpenInBoard = () => {
    const pgn = reviewer.originalPgn;
    if (!pgn) return;
    const review = reviewer.review;
    const goRaw = () => router.push(`/board?pgn=${encodeURIComponent(pgn)}`);
    if (!review) { goRaw(); return; }
    try {
      const enriched = buildEnrichedPgn(pgn, review, reviewer.headers);
      router.push(`/board?pgn=${encodeURIComponent(enriched)}`);
    } catch {
      goRaw();
    }
  };

  if (!initialPgn) {
    return (
      <div className="p-6 text-center text-zinc-400">
        <h1 className="text-xl font-bold text-zinc-100 mb-2">Puzzle Generator</h1>
        <p className="text-sm">
          Open a game on the <Link href="/board" className="text-blue-400 underline">board</Link> and use
          &ldquo;Send to Puzzle Generator&rdquo; from its menu.
        </p>
        <DevConsole />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <h1 className="text-xl font-bold text-zinc-100 px-1">Puzzle Generator</h1>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
        {/* Eval bar + board */}
        <div
          className="flex gap-px lg:gap-1.5 items-start shrink-0"
          style={{ width: 'min(100vw, 90vh, 560px)', maxWidth: '100%' }}
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
            />
          </div>

          {/* Severity + Generate — kept OUTSIDE the scrollable move list below,
              so paging through moves (which auto-scrolls to the active move)
              never pushes these controls out of view. */}
          {reviewer.review && !reviewer.isLoading && (
            <div className="order-2 lg:order-1 shrink-0 px-1">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-zinc-400" htmlFor="severity">Extract from:</label>
                <select
                  id="severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as BlunderSeverityFilter)}
                  className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100"
                >
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-3 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
                >
                  {generating ? 'Generating…' : 'Generate Puzzles'}
                </button>
              </div>
              {genError && <p className="text-sm text-red-400 mt-1.5">{genError}</p>}
              {result && (
                <p className="text-xs text-zinc-500 mt-1.5">
                  {result.puzzles.length} puzzle{result.puzzles.length === 1 ? '' : 's'} generated from{' '}
                  {result.flaggedMoveCount} flagged move{result.flaggedMoveCount === 1 ? '' : 's'}
                  {result.puzzles.length === 0 && ' — no moves matched that severity filter.'}
                </p>
              )}
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
                onSelectMove={reviewer.goToMove}
                puzzlesByMoveIndex={puzzlesByMoveIndex}
                selectedPuzzleId={selectedPuzzleId}
                onSelectPuzzle={handleSelectPuzzle}
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
          onHide={() => setHideAnalysisModal(true)}
        />
      )}

      <DevConsole />
    </div>
  );
}
