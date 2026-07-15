'use client';
import { useState, useCallback, useRef } from 'react';
import { analyseGame, GameReview, ReviewedMove, ReviewLogEvent } from '@/lib/analysis';
import { loadStoredReview, saveReviewForPgn } from '@/lib/reviewStore';
import { sanitizePgn } from '@/lib/gameTree';
import { parsePgnHeaders } from '@/lib/pgnImport';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface GameReviewerProgress {
  phase:   'scan' | 'deep';
  current: number;
  total:   number;
}

export interface UseGameReviewerReturn {
  // Analysis state
  review:       GameReview | null;
  isLoading:    boolean;
  error:        string | null;
  progress:     GameReviewerProgress;
  logs:         ReviewLogEvent[];   // structured run log, streamed while analysing
  originalPgn:  string | null;
  headers:      Record<string, string>;

  // Board navigation
  currentMoveIndex: number;   // -1 = start position; 0..n-1 = after move i
  currentFen:       string;
  currentMove:      ReviewedMove | null;  // null at start position
  currentEval:      number;              // cp, White's perspective

  // True when the current review was loaded from the library instead of a
  // fresh engine run (enables the Re-analyse affordance).
  fromStore:  boolean;

  // Actions
  loadPgn:    (pgn: string) => Promise<void>;
  reanalyse:  () => Promise<void>;
  goToMove:   (index: number) => void;
  goForward:  () => void;
  goBack:     () => void;
  goToStart:  () => void;
  goToEnd:    () => void;
}

export function useGameReviewer(): UseGameReviewerReturn {
  const [review, setReview]           = useState<GameReview | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [progress, setProgress]       = useState<GameReviewerProgress>({ phase: 'scan', current: 0, total: 0 });
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [originalPgn, setOriginalPgn] = useState<string | null>(null);
  const [headers, setHeaders]         = useState<Record<string, string>>({});
  const [logs, setLogs]               = useState<ReviewLogEvent[]>([]);
  const [fromStore, setFromStore]     = useState(false);

  // Increments on every new loadPgn call so stale async results are discarded
  const analysisIdRef = useRef(0);

  const runAnalysis = useCallback(async (pgn: string, skipStore: boolean) => {
    const clean = sanitizePgn(pgn); // normalise mobile-paste quirks before parsing
    const id = ++analysisIdRef.current;
    setIsLoading(true);
    setError(null);
    setReview(null);
    setFromStore(false);
    setOriginalPgn(clean);
    setHeaders(parsePgnHeaders(clean));
    setCurrentMoveIndex(-1);
    setProgress({ phase: 'scan', current: 0, total: 0 });
    setLogs([]);

    // Library short-circuit: an up-to-date stored review for this exact
    // movetext skips the engine entirely.
    if (!skipStore) {
      try {
        const stored = await loadStoredReview(clean);
        if (stored && analysisIdRef.current === id) {
          setReview(stored.review);
          setFromStore(true);
          setIsLoading(false);
          console.log(`[reviewer] loaded stored review for "${stored.game.title ?? stored.game.id}" — engine skipped`);
          (window as unknown as { __review?: GameReview }).__review = stored.review;
          return;
        }
      } catch (err) {
        console.warn('[reviewer] stored-review lookup failed, analysing fresh:', err);
      }
    }

    try {
      const t0 = performance.now();
      const result = await analyseGame(
        clean,
        (p) => {
          if (analysisIdRef.current === id) setProgress(p);
        },
        (e) => {
          if (analysisIdRef.current === id) setLogs((prev) => [...prev, e]);
        },
      );
      if (analysisIdRef.current === id) {
        setReview(result);
        setCurrentMoveIndex(-1);
        // Structured completion log + a window handle so devtools (and the
        // E2E benchmark) can inspect the full review object directly.
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        const fmt = (s: GameReview['whiteSummary']) =>
          `${s.accuracy.toFixed(1)}% (?!${s.counts.inaccuracy} ?${s.counts.mistake} ×${s.counts.miss} ??${s.counts.blunder})`;
        console.log(`[reviewer] done in ${secs}s · ${result.moves.length} moves · W ${fmt(result.whiteSummary)} · B ${fmt(result.blackSummary)}`);
        (window as unknown as { __review?: GameReview }).__review = result;
        // Persist to the library when this game lives there (fire-and-forget;
        // a failure only costs the cache, never the on-screen review).
        saveReviewForPgn(clean, result)
          .then((gameId) => { if (gameId) console.log(`[reviewer] review saved to library game ${gameId}`); })
          .catch((err) => console.warn('[reviewer] failed to persist review:', err));
      }
    } catch (err) {
      console.error('[GameReviewer] Analysis failed:', err);
      if (analysisIdRef.current === id) {
        setError(err instanceof Error ? err.message : 'Analysis failed. Check the PGN and try again.');
      }
    } finally {
      if (analysisIdRef.current === id) setIsLoading(false);
    }
  }, []);

  const loadPgn = useCallback((pgn: string) => runAnalysis(pgn, false), [runAnalysis]);

  // Force a fresh engine run for the currently loaded PGN (bypasses and then
  // overwrites the stored review).
  const reanalyse = useCallback(async () => {
    if (originalPgn) await runAnalysis(originalPgn, true);
  }, [originalPgn, runAnalysis]);

  const goToMove = useCallback((index: number) => {
    if (!review) return;
    setCurrentMoveIndex(Math.max(-1, Math.min(review.moves.length - 1, index)));
  }, [review]);

  const goForward = useCallback(() => {
    if (!review) return;
    setCurrentMoveIndex(i => Math.min(review.moves.length - 1, i + 1));
  }, [review]);

  const goBack = useCallback(() => {
    setCurrentMoveIndex(i => Math.max(-1, i - 1));
  }, []);

  const goToStart = useCallback(() => setCurrentMoveIndex(-1), []);

  const goToEnd = useCallback(() => {
    if (review) setCurrentMoveIndex(review.moves.length - 1);
  }, [review]);

  // Derived values
  const currentMove = review && currentMoveIndex >= 0
    ? review.moves[currentMoveIndex]
    : null;

  const currentFen = review
    ? currentMoveIndex === -1
      ? (review.moves[0]?.fenBefore ?? START_FEN)
      : review.moves[currentMoveIndex].fenAfter
    : START_FEN;

  const currentEval = review
    ? currentMoveIndex === -1
      ? (review.moves[0]?.evalBefore ?? 0)
      : review.moves[currentMoveIndex].evalAfter
    : 0;

  return {
    review,
    isLoading,
    error,
    progress,
    logs,
    originalPgn,
    headers,
    fromStore,
    currentMoveIndex,
    currentFen,
    currentMove,
    currentEval,
    loadPgn,
    reanalyse,
    goToMove,
    goForward,
    goBack,
    goToStart,
    goToEnd,
  };
}
