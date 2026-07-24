'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare, Piece } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import type { Square } from 'chess.js';
import { useLeitnerPractice } from '@/hooks/useLeitnerPractice';

const KIND_LABEL = { 'avoid-blunder': 'Find the best move', 'punish-blunder': 'Punish the blunder' } as const;

function pieceColor(piece: Piece): 'w' | 'b' {
  return piece[0] as 'w' | 'b';
}

// White-POV FEN + a UCI move → the move's SAN, for the "the answer was..."
// feedback message.
function uciToSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
    });
    return move?.san ?? uci;
  } catch {
    return uci;
  }
}

export function LearnFromMistakesShell() {
  const practice = useLeitnerPractice();
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const puzzle = practice.currentPuzzle;
  const locked = !!practice.feedback; // board freezes once an answer's been submitted, until Continue

  const legalDests = useCallback((from: Square, fen: string): Set<string> => {
    try {
      return new Set(new Chess(fen).moves({ square: from, verbose: true }).map((m) => m.to));
    } catch {
      return new Set();
    }
  }, []);

  const handleMove = useCallback((from: Square, to: Square) => {
    if (!puzzle || locked) return;
    const chess = new Chess(puzzle.fen);
    // v1 simplification: auto-queen on promotion rather than a picker dialog.
    const move = chess.move({ from, to, promotion: 'q' });
    if (!move) { setSelectedSq(null); return; }
    practice.submitAnswer(move.from + move.to + (move.promotion ?? ''));
    setSelectedSq(null);
  }, [puzzle, locked, practice]);

  const handleSquareClick = useCallback((sq: CbSquare, piece: Piece | undefined) => {
    if (!puzzle || locked) return;
    const square = sq as Square;
    const mover = puzzle.fen.split(' ')[1] as 'w' | 'b';
    if (selectedSq) {
      if (legalDests(selectedSq, puzzle.fen).has(square)) {
        handleMove(selectedSq, square);
        return;
      }
      setSelectedSq(piece && pieceColor(piece) === mover ? square : null);
      return;
    }
    if (piece && pieceColor(piece) === mover) setSelectedSq(square);
  }, [puzzle, locked, selectedSq, legalDests, handleMove]);

  const handlePieceDrop = useCallback((from: CbSquare, to: CbSquare): boolean => {
    if (!puzzle || locked) return false;
    handleMove(from as Square, to as Square);
    return true;
  }, [puzzle, locked, handleMove]);

  const handleContinue = useCallback(() => {
    setSelectedSq(null);
    practice.continueToNext();
  }, [practice]);

  if (practice.isLoading) {
    return <div className="p-6 text-center text-zinc-400 text-sm">Loading…</div>;
  }

  if (practice.hasNoPuzzles) {
    return (
      <div className="p-6 text-center text-zinc-400">
        <h1 className="text-xl font-bold text-zinc-100 mb-2">Learn From Mistakes</h1>
        <p className="text-sm">
          No puzzles yet — generate some from a game on the{' '}
          <Link href="/puzzle-generator" className="text-blue-400 underline">Puzzle Generator</Link> first.
        </p>
      </div>
    );
  }

  if (practice.sessionDone) {
    return (
      <div className="p-6 text-center text-zinc-300">
        <h1 className="text-xl font-bold text-zinc-100 mb-2">Session complete</h1>
        <p className="text-sm">{practice.stats.right} right · {practice.stats.wrong} wrong</p>
      </div>
    );
  }

  if (!puzzle) return null;

  const squareStyles = selectedSq ? { [selectedSq]: { backgroundColor: 'rgba(20, 85, 30, 0.5)' } } : {};

  return (
    <div className="p-4 flex flex-col items-center gap-3">
      <h1 className="text-xl font-bold text-zinc-100">Learn From Mistakes</h1>
      <p className="text-sm text-zinc-400">
        Puzzle {practice.currentIndex + 1}/{practice.queue.length} · {KIND_LABEL[puzzle.kind]} ·{' '}
        {practice.stats.right} right · {practice.stats.wrong} wrong
      </p>

      <div style={{ width: 'min(90vw, 480px)' }}>
        <Chessboard
          position={puzzle.fen}
          boardWidth={480}
          boardOrientation={puzzle.fen.split(' ')[1] === 'b' ? 'black' : 'white'}
          onSquareClick={handleSquareClick}
          onPieceDrop={handlePieceDrop}
          areArrowsAllowed={false}
          customSquareStyles={squareStyles}
        />
      </div>

      {practice.feedback && (
        <div className="flex flex-col items-center gap-2">
          <div className={`text-sm font-semibold ${practice.feedback.correct ? 'text-emerald-400' : 'text-red-400'}`}>
            {practice.feedback.correct
              ? 'Correct!'
              : `Not quite — the answer was ${uciToSan(puzzle.fen, puzzle.solutionUci)}`}
          </div>
          <button
            onClick={handleContinue}
            className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
