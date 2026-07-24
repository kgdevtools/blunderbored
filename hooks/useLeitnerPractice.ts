'use client';
import { useCallback, useEffect, useState } from 'react';
import { db, type Puzzle, type LeitnerBox } from '@/lib/db';
import { buildSession, assignResult, nextSessionNumber, type LeitnerState } from '@/lib/leitner';

export interface SessionStats {
  right: number;
  wrong: number;
}

export interface AnswerFeedback {
  correct: boolean;
}

export interface UseLeitnerPracticeReturn {
  isLoading: boolean;
  // True once loaded when there are no puzzles at all yet (nothing generated).
  hasNoPuzzles: boolean;
  queue: Puzzle[];
  currentIndex: number;
  // Stays put (doesn't advance) until continueToNext() is called — this is
  // what a puzzle answered but not yet dismissed and the puzzle currently
  // awaiting an attempt both look like from the caller's side.
  currentPuzzle: Puzzle | null;
  stats: SessionStats;
  sessionDone: boolean;
  // Set by submitAnswer, cleared by continueToNext — the caller shows this
  // (and a "Continue" affordance) instead of immediately jumping ahead.
  feedback: AnswerFeedback | null;
  submitAnswer: (uci: string) => boolean; // returns whether it was correct
  continueToNext: () => void;
}

interface PendingOutcome {
  puzzleId: string;
  correct: boolean;
  box: number;
  masteredAtSession?: number;
}

// A session snapshot is built once (not via a reactive live-query) precisely
// because every answer eventually writes to leitnerBoxes — a reactive query
// would reshuffle/regenerate the queue mid-session as box state changes.
export function useLeitnerPractice(): UseLeitnerPracticeReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [hasNoPuzzles, setHasNoPuzzles] = useState(false);
  const [queue, setQueue] = useState<Puzzle[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState<SessionStats>({ right: 0, wrong: 0 });
  const [boxByPuzzleId, setBoxByPuzzleId] = useState<Map<string, LeitnerBox>>(new Map());
  const [sessionNum, setSessionNum] = useState(1);
  const [pending, setPending] = useState<PendingOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [puzzles, boxes] = await Promise.all([db.puzzles.toArray(), db.leitnerBoxes.toArray()]);
      if (cancelled) return;
      if (puzzles.length === 0) {
        setHasNoPuzzles(true);
        setIsLoading(false);
        return;
      }
      const boxMap = new Map(boxes.map((b) => [b.puzzleId, b]));
      const states: LeitnerState[] = puzzles.map((p) => {
        const b = boxMap.get(p.id);
        return {
          puzzleId: p.id,
          box: b?.box ?? 0,
          lastSessionNum: b?.lastSessionNum ?? 0,
          masteredAtSession: b?.masteredAtSession,
        };
      });
      const nextNum = nextSessionNumber(states);
      const sessionIds = buildSession(states, nextNum);
      const puzzleById = new Map(puzzles.map((p) => [p.id, p]));
      const sessionQueue = sessionIds.map((id) => puzzleById.get(id)).filter((p): p is Puzzle => !!p);

      setSessionNum(nextNum);
      setBoxByPuzzleId(boxMap);
      setQueue(sessionQueue);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const submitAnswer = useCallback((uci: string): boolean => {
    const puzzle = queue[currentIndex];
    if (!puzzle || pending) return false; // already answered — awaiting continueToNext()
    const correct = uci === puzzle.solutionUci;
    const prevBox = boxByPuzzleId.get(puzzle.id)?.box ?? 0;
    const outcome = assignResult(prevBox, correct, sessionNum);
    setPending({ puzzleId: puzzle.id, correct, box: outcome.box, masteredAtSession: outcome.masteredAtSession });
    setStats((prev) => ({ right: prev.right + (correct ? 1 : 0), wrong: prev.wrong + (correct ? 0 : 1) }));
    return correct;
  }, [queue, currentIndex, pending, boxByPuzzleId, sessionNum]);

  const continueToNext = useCallback(() => {
    if (!pending) return;
    const existing = boxByPuzzleId.get(pending.puzzleId);
    const updated: LeitnerBox = {
      puzzleId: pending.puzzleId,
      box: pending.box,
      lastSessionNum: sessionNum,
      rightCount: (existing?.rightCount ?? 0) + (pending.correct ? 1 : 0),
      wrongCount: (existing?.wrongCount ?? 0) + (pending.correct ? 0 : 1),
      masteredAtSession: pending.masteredAtSession ?? existing?.masteredAtSession,
    };
    db.leitnerBoxes.put(updated).catch(() => {});
    setBoxByPuzzleId((prev) => new Map(prev).set(pending.puzzleId, updated));
    setPending(null);
    setCurrentIndex((i) => i + 1);
  }, [pending, boxByPuzzleId, sessionNum]);

  return {
    isLoading,
    hasNoPuzzles,
    queue,
    currentIndex,
    currentPuzzle: queue[currentIndex] ?? null,
    stats,
    sessionDone: !isLoading && !hasNoPuzzles && !pending && currentIndex >= queue.length,
    feedback: pending ? { correct: pending.correct } : null,
    submitAnswer,
    continueToNext,
  };
}
