'use client';
import { useState, useCallback, useRef } from 'react';
import { analyseGame, GameReview, ReviewedMove } from '@/lib/analysis';
import { sanitizePgn } from '@/lib/gameTree';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface GameReviewerProgress {
  current: number;
  total: number;
}

export interface UseGameReviewerReturn {
  // Analysis state
  review:       GameReview | null;
  isLoading:    boolean;
  error:        string | null;
  progress:     GameReviewerProgress;
  originalPgn:  string | null;
  headers:      Record<string, string>;

  // Board navigation
  currentMoveIndex: number;   // -1 = start position; 0..n-1 = after move i
  currentFen:       string;
  currentMove:      ReviewedMove | null;  // null at start position
  currentEval:      number;              // cp, White's perspective

  // Actions
  loadPgn:    (pgn: string) => Promise<void>;
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
  const [progress, setProgress]       = useState<GameReviewerProgress>({ current: 0, total: 0 });
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [originalPgn, setOriginalPgn] = useState<string | null>(null);
  const [headers, setHeaders]         = useState<Record<string, string>>({});

  // Increments on every new loadPgn call so stale async results are discarded
  const analysisIdRef = useRef(0);

  const loadPgn = useCallback(async (pgn: string) => {
    const clean = sanitizePgn(pgn); // normalise mobile-paste quirks before parsing
    const id = ++analysisIdRef.current;
    setIsLoading(true);
    setError(null);
    setReview(null);
    setOriginalPgn(clean);
    // Parse PGN headers
    const parsed: Record<string, string> = {};
    for (const m of clean.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) parsed[m[1]] = m[2];
    setHeaders(parsed);
    setCurrentMoveIndex(-1);
    setProgress({ current: 0, total: 0 });

    try {
      const result = await analyseGame(clean, (current, total) => {
        if (analysisIdRef.current === id) setProgress({ current, total });
      });
      if (analysisIdRef.current === id) {
        setReview(result);
        setCurrentMoveIndex(-1);
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
    originalPgn,
    headers,
    currentMoveIndex,
    currentFen,
    currentMove,
    currentEval,
    loadPgn,
    goToMove,
    goForward,
    goBack,
    goToStart,
    goToEnd,
  };
}
