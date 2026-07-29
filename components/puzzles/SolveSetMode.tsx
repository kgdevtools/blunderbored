'use client';
// Solve mode for a generated puzzle set — interaction modeled on the academy
// lesson-puzzle viewer (lca-auth PuzzleViewerBlock): the solver plays their
// side of the stored solution line, the board auto-replies the opponent's
// moves, a wrong move flashes red and can be retried. The board transport at
// the bottom (same BoardTransport /board uses) always browses the puzzle's
// full authored line (leading move + solution), independent of solving
// progress; puzzle-level actions (retry/reveal/confirm/prev-next-puzzle) sit
// at the top since they act on the puzzle, not on board navigation.
//
// `mode="preview"` is the same viewer, launched from the Puzzle Creator to
// test-play a puzzle that was just saved — it swaps the header for a
// "Preview" badge and adds a Confirm action; `mode="solve"` (a saved
// WorkoutSet opened from the Puzzle Set tab / Library) is unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, Piece } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import type { Square } from 'chess.js';
import type { Puzzle } from '@/lib/db';
import { QUALITY_META } from '@/lib/accuracy';
import { solutionLine, applyUci, buildSolutionSans } from '@/lib/puzzleSolution';
import { BoardTransport } from '@/components/board/BoardControls';

const REPLY_DELAY_MS = 600;

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Small end-of-session report — shown whether the set finished naturally or
// the timer ran out, so the solver always sees what they actually did.
function SessionReport({ right, wrong, elapsedMs }: { right: number; wrong: number; elapsedMs: number }) {
  const attempted = right + wrong;
  const accuracy = attempted > 0 ? Math.round((right / attempted) * 100) : 0;
  return (
    <div className="rounded-md bg-zinc-800 border border-zinc-700 p-4 space-y-3">
      <div className="flex justify-center gap-8">
        <div>
          <p className="text-3xl font-bold text-emerald-400 tabular-nums">{right}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Solved</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-red-400 tabular-nums">{wrong}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Missed</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-zinc-100 tabular-nums">{accuracy}%</p>
          <p className="text-xs text-zinc-500 mt-0.5">Accuracy</p>
        </div>
      </div>
      <p className="text-xs text-zinc-500 text-center">
        {attempted} puzzle{attempted === 1 ? '' : 's'} attempted · {fmtDuration(elapsedMs)}
      </p>
    </div>
  );
}

interface SolveSetModeProps {
  puzzles: Puzzle[];
  onExit: () => void;
  mode?: 'solve' | 'preview';
  initialIndex?: number;
  // The whole set's time allocation (a set-level setting, decided once at
  // "+ New Workout" — see WorkoutsTab), not per-puzzle. undefined = untimed.
  // Previews from the Creator are always untimed regardless of the set.
  setTimerSeconds?: number;
}

export function SolveSetMode({ puzzles, onExit, mode = 'solve', initialIndex = 0, setTimerSeconds }: SolveSetModeProps) {
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(puzzles.length - 1, 0)));
  const puzzle = puzzles[index];
  const line = useMemo(() => (puzzle ? solutionLine(puzzle) : []), [puzzle]);

  const timerDuration = mode === 'preview' ? null : (setTimerSeconds ?? null);
  const [timeLeft, setTimeLeft] = useState(timerDuration ?? 0);
  const [timerActive, setTimerActive] = useState(timerDuration !== null);
  const [timesUp, setTimesUp] = useState(false);

  // ── Per-puzzle solving state ────────────────────────────────────────────────
  const [position, setPosition] = useState(puzzle?.fen ?? '');
  const [plyDone, setPlyDone] = useState(0);
  const [solved, setSolved] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [wrongMove, setWrongMove] = useState<{ from: string; to: string } | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const [replying, setReplying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [stats, setStats] = useState({ right: 0, wrong: 0 });
  const [flipped, setFlipped] = useState(false);
  const missedRef = useRef(false);
  // For the end-of-session report — Date.now()/ref reads aren't allowed
  // during render, so the elapsed time is computed once in an effect (below)
  // rather than read live in JSX.
  const sessionStartRef = useRef(0);
  useEffect(() => { sessionStartRef.current = Date.now(); }, []);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);

  // ── Board sizing — panel height matches this, same convention as /board. ──
  const boardColRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useEffect(() => {
    const el = boardColRef.current;
    if (!el) return;
    const apply = (w: number) => { if (w > 0) setBoardWidth(Math.min(Math.floor(w), 560)); };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timerRunning = timerActive && stats.right + stats.wrong < puzzles.length;

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { setTimerActive(false); setTimesUp(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // ── Full authored line (leading move + solution), always browsable ────────
  const { fens: solFens, sans: solSans } = useMemo(() => {
    if (!puzzle) return { fens: [''], sans: [] as string[] };
    return buildSolutionSans(puzzle.fen, line);
  }, [puzzle, line]);

  const [browsing, setBrowsing] = useState(false);
  const [navIndex, setNavIndex] = useState(0);

  // setState-only reset — safe to call during render (below) as well as from
  // an event handler. missedRef is handled separately (see effect below):
  // refs can't be touched during render, only in effects/handlers.
  const resetPuzzleState = useCallback((p: Puzzle | undefined) => {
    setPosition(p?.fen ?? '');
    setPlyDone(0);
    setSolved(false);
    setGaveUp(false);
    setWrongMove(null);
    setLastMove(p?.leadingMoveUci ? { from: p.leadingMoveUci.slice(0, 2), to: p.leadingMoveUci.slice(2, 4) } : null);
    setSelectedSq(null);
    setReplying(false);
    setFeedback(null);
    setBrowsing(false);
    setNavIndex(0);
  }, []);

  const resetPuzzle = useCallback((p: Puzzle | undefined) => {
    resetPuzzleState(p);
    missedRef.current = false;
  }, [resetPuzzleState]);

  // Index (or the puzzle it points at) changed → reset solving state.
  // Adjusted during render rather than an effect, same idiom used elsewhere
  // in this codebase (e.g. PuzzleGeneratorShell) for "reset state when a prop
  // changes" without a cascading-render effect. The ref reset can't happen
  // here (no refs during render) — a plain effect handles that part.
  const [seenPuzzle, setSeenPuzzle] = useState(puzzle);
  if (puzzle !== seenPuzzle) {
    setSeenPuzzle(puzzle);
    resetPuzzleState(puzzle);
  }
  useEffect(() => { missedRef.current = false; }, [puzzle]);

  const solverColor: 'w' | 'b' = (puzzle?.fen.split(' ')[1] as 'w' | 'b') ?? 'w';
  const locked = solved || gaveUp || replying;

  const finishCorrect = useCallback(() => {
    setSolved(true);
    setFeedback('Solved!');
    setStats((s) => (missedRef.current ? s : { ...s, right: s.right + 1 }));
  }, []);

  const playReply = useCallback((fromFen: string, done: number) => {
    const replyUci = line[done];
    if (!replyUci) { finishCorrect(); return; }
    setReplying(true);
    setTimeout(() => {
      const r = applyUci(fromFen, replyUci);
      setReplying(false);
      if (!r) { finishCorrect(); return; }
      setPosition(r.fen);
      setLastMove({ from: r.from, to: r.to });
      const next = done + 1;
      setPlyDone(next);
      if (next >= line.length) finishCorrect();
    }, REPLY_DELAY_MS);
  }, [line, finishCorrect]);

  const handleMove = useCallback((from: Square, to: Square): boolean => {
    if (!puzzle || locked) return false;
    const attempt = applyUci(position, `${from}${to}`) ?? applyUci(position, `${from}${to}q`);
    if (!attempt) { setSelectedSq(null); return false; }

    const expected = line[plyDone];
    const played = `${from}${to}`;
    const expectedFromTo = expected ? expected.slice(0, 4) : '';

    const isAltFirst = plyDone === 0
      && (puzzle.altFirstMovesUci ?? []).some((u) => u.slice(0, 4) === played);

    if (played === expectedFromTo) {
      setPosition(attempt.fen);
      setLastMove({ from, to });
      setWrongMove(null);
      setSelectedSq(null);
      setFeedback(null);
      const done = plyDone + 1;
      setPlyDone(done);
      if (done >= line.length) finishCorrect();
      else playReply(attempt.fen, done);
      return true;
    }

    if (isAltFirst) {
      setPosition(attempt.fen);
      setLastMove({ from, to });
      setWrongMove(null);
      setSelectedSq(null);
      setSolved(true);
      setFeedback('Also winning — the main line continues differently. Solved!');
      setStats((s) => (missedRef.current ? s : { ...s, right: s.right + 1 }));
      return true;
    }

    if (!missedRef.current) {
      missedRef.current = true;
      setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
    }
    setWrongMove({ from, to });
    setSelectedSq(null);
    setFeedback('Not the solution — try again.');
    return false;
  }, [puzzle, locked, position, line, plyDone, playReply, finishCorrect]);

  const legalDests = useCallback((from: Square): Set<string> => {
    try {
      return new Set(new Chess(position).moves({ square: from, verbose: true }).map((m) => m.to));
    } catch {
      return new Set();
    }
  }, [position]);

  // Browsing the transport shows a historical frame — the first click/drag
  // just snaps back to the live position rather than attempting a move
  // against a position that isn't actually on the board's live state.
  const handleSquareClick = useCallback((sq: CbSquare, piece: Piece | undefined) => {
    if (locked) return;
    if (browsing) { setBrowsing(false); return; }
    const square = sq as Square;
    if (selectedSq) {
      if (legalDests(selectedSq).has(square)) { handleMove(selectedSq, square); return; }
      setSelectedSq(piece && piece[0] === solverColor ? square : null);
      return;
    }
    if (piece && piece[0] === solverColor) setSelectedSq(square);
  }, [locked, browsing, selectedSq, legalDests, handleMove, solverColor]);

  const handleDrop = useCallback((from: CbSquare, to: CbSquare): boolean => {
    if (locked) return false;
    if (browsing) { setBrowsing(false); return false; }
    return handleMove(from as Square, to as Square);
  }, [locked, browsing, handleMove]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (lastMove && !wrongMove) {
      styles[lastMove.from] = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
      styles[lastMove.to] = { backgroundColor: 'rgba(155, 199, 0, 0.41)' };
    }
    if (wrongMove) {
      styles[wrongMove.from] = { backgroundColor: 'rgba(239, 68, 68, 0.55)' };
      styles[wrongMove.to] = { backgroundColor: 'rgba(239, 68, 68, 0.55)' };
    }
    if (selectedSq) {
      styles[selectedSq] = { backgroundColor: 'rgba(250, 204, 21, 0.45)' };
      for (const d of legalDests(selectedSq)) styles[d] = { backgroundColor: 'rgba(34, 197, 94, 0.30)' };
    }
    return styles;
  }, [lastMove, wrongMove, selectedSq, legalDests]);

  const boardFen = browsing ? (solFens[navIndex] ?? position) : position;
  const boardOrientation = (solverColor === 'b') !== flipped ? 'black' : 'white';

  const meta = puzzle ? QUALITY_META[puzzle.severity] : null;

  const canNavPrev = navIndex > 0;
  const canNavNext = navIndex < solFens.length - 1;
  const navGoStart = useCallback(() => { setNavIndex(0); setBrowsing(true); }, []);
  const navGoPrev = useCallback(() => { setNavIndex((i) => Math.max(0, i - 1)); setBrowsing(true); }, []);
  const navGoNext = useCallback(() => { setNavIndex((i) => Math.min(solFens.length - 1, i + 1)); setBrowsing(true); }, [solFens.length]);
  const navGoEnd = useCallback(() => { setNavIndex(solFens.length - 1); setBrowsing(true); }, [solFens.length]);

  const handleReveal = useCallback(() => {
    setGaveUp(true);
    setBrowsing(true);
    setNavIndex(solFens.length - 1);
    setFeedback(null);
  }, [solFens.length]);

  const handleRetry = useCallback(() => resetPuzzle(puzzle), [resetPuzzle, puzzle]);

  // Capture the report's elapsed time once, the moment the session actually
  // ends — never read live during render (Date.now()/ref reads aren't pure).
  const allDone = (solved || gaveUp) && index >= puzzles.length - 1 && mode === 'solve';
  useEffect(() => {
    if (timesUp || allDone) {
      setFinalElapsedMs((prev) => prev ?? Date.now() - sessionStartRef.current);
    }
  }, [timesUp, allDone]);

  if (!puzzle) return null;

  const navBtn = 'flex-1 py-1.5 rounded-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

  if (timesUp) {
    return (
      <div className="max-w-sm mx-auto p-6 text-center space-y-4">
        <h2 className="text-lg font-bold text-zinc-100">Time&rsquo;s up!</h2>
        <SessionReport right={stats.right} wrong={stats.wrong} elapsedMs={finalElapsedMs ?? 0} />
        <button
          onClick={onExit}
          className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold"
        >
          Back to puzzles
        </button>
      </div>
    );
  }

  const panelHeight = boardWidth > 0 ? boardWidth : undefined;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
      {/* Board */}
      <div ref={boardColRef} className="shrink-0 w-full min-w-0" style={{ width: 'min(100vw, 90vh, 560px)', maxWidth: '100%' }}>
        <div className="w-full" style={{ aspectRatio: '1 / 1' }}>
          {boardWidth > 0 && (
            <Chessboard
              position={boardFen}
              boardWidth={boardWidth}
              boardOrientation={boardOrientation}
              onSquareClick={handleSquareClick}
              onPieceDrop={handleDrop}
              arePiecesDraggable={!locked}
              customSquareStyles={squareStyles}
              areArrowsAllowed={false}
            />
          )}
        </div>
      </div>

      {/* Right panel — same height as the board; content scrolls internally
          so the board controls at the bottom stay genuinely pinned. */}
      <div
        className="w-full lg:flex-1 lg:min-w-0 min-w-0 bg-zinc-900 rounded-md p-3 flex flex-col overflow-hidden"
        style={{ height: panelHeight, maxHeight: 'calc(100dvh - 6.5rem)' }}
      >
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2">
        {/* Header: prominent prev/next + puzzle count on the left, a
            prominent timer clock top-right when the set is timed. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {mode === 'preview' && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400 bg-amber-500/15 border border-amber-500/40 rounded px-1.5 py-0.5">
                Preview
              </span>
            )}
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              title="Previous puzzle"
              className="w-7 h-7 grid place-items-center rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-base font-bold text-zinc-100 transition-colors"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-zinc-200 px-0.5">
              Puzzle {index + 1}<span className="text-zinc-500 font-normal">/{puzzles.length}</span>
            </span>
            <button
              onClick={() => setIndex((i) => Math.min(puzzles.length - 1, i + 1))}
              disabled={index >= puzzles.length - 1}
              title="Next puzzle"
              className="w-7 h-7 grid place-items-center rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-base font-bold text-zinc-100 transition-colors"
            >
              ›
            </button>
            {meta && <span className={`ml-1 text-xs font-mono font-bold ${meta.color}`}>{meta.symbol || meta.label}</span>}
          </div>
          {timerDuration !== null && (
            <div className={`text-base font-bold tabular-nums px-2.5 py-1 rounded shrink-0 ${timeLeft <= 10 ? 'text-red-400 bg-red-900/30' : 'text-zinc-100 bg-zinc-800'}`}>
              ⏱ {fmtClock(timeLeft)}
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-400">{solverColor === 'w' ? 'White' : 'Black'} to move.</p>

        {/* Feedback — background tint + colour only, no border */}
        {feedback && (
          <div className={`px-2 py-1.5 rounded text-xs font-medium ${
            solved ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'
          }`}>
            {feedback}
          </div>
        )}
        {gaveUp && !feedback && (
          <div className="px-2 py-1.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300">Solution shown.</div>
        )}

        {/* Puzzle-level actions — these act on the puzzle, not board nav */}
        <div className="flex gap-1 flex-wrap">
          <button className={navBtn} onClick={handleRetry}>↺ Retry</button>
          <button className={navBtn} onClick={handleReveal} disabled={gaveUp}>👁 Solution</button>
          {mode === 'preview' ? (
            <>
              <button
                className="flex-none px-2.5 py-1.5 rounded-sm bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
                onClick={onExit}
              >
                ◁ Editing
              </button>
              <button
                className="flex-none px-2.5 py-1.5 rounded-sm bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold transition-colors"
                onClick={onExit}
              >
                ✓ Confirm
              </button>
            </>
          ) : (
            <button
              className="flex-none px-2.5 py-1.5 rounded-sm bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
              onClick={onExit}
              title="Back to the puzzle sets view"
            >
              Exit
            </button>
          )}
        </div>

        {(solved || gaveUp) && index < puzzles.length - 1 && mode === 'solve' && (
          <button
            onClick={() => setIndex((i) => i + 1)}
            className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold self-start"
          >
            Next puzzle →
          </button>
        )}
        {(solved || gaveUp) && index >= puzzles.length - 1 && mode === 'solve' && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-semibold">Set complete</p>
            <SessionReport right={stats.right} wrong={stats.wrong} elapsedMs={finalElapsedMs ?? 0} />
          </div>
        )}

      </div>{/* /scrollable content */}

        {/* Board controls — pinned to the bottom, same set/behavior as
            /board's BoardControls. Always browses the full authored line
            (leading move + solution), independent of solving progress. */}
        <div className="shrink-0 flex gap-0.5 pt-2 border-t border-zinc-800">
          <BoardTransport
            onStart={navGoStart} onPrev={navGoPrev} onNext={navGoNext} onEnd={navGoEnd}
            onFlip={() => setFlipped((f) => !f)}
            canPrev={canNavPrev} canNext={canNavNext}
          />
        </div>
        {browsing && (
          <p className="text-[10px] text-zinc-600 text-center -mt-1">
            Browsing move {navIndex + 1}/{solFens.length} of {solSans.length ? solSans.join(' ') : '—'} · make a move to return to solving
          </p>
        )}
      </div>
    </div>
  );
}
