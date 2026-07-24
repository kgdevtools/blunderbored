// Blunder → puzzle extraction, informed by Lucas Chess's
// AnalysisGameSaveTrainings.graba_tactic() (github.com/lukasmonk/lucaschessR6):
// for every flagged mistake/blunder in an already-analysed game, emit two
// puzzles — "avoid it" (solve from the position before, with the move that
// should have been played) and "punish it" (solve from the position after,
// with the opponent's best refutation).

import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { engineService } from './engine';
import { PASS2_DEPTH, type GameReview } from './analysis';
import type { MoveQuality } from './accuracy';
import { db, type Puzzle } from './db';
import { devlog } from './devlog';

export type BlunderSeverityFilter = 'blunder-only' | 'mistake-and-blunder' | 'all-flagged';

// Mirrors Lucas Chess's configurable `kblunders_condition` — which move
// severities count as worth turning into a puzzle.
const SEVERITY_SETS: Record<BlunderSeverityFilter, ReadonlySet<MoveQuality>> = {
  'blunder-only': new Set(['blunder']),
  'mistake-and-blunder': new Set(['mistake', 'blunder']),
  'all-flagged': new Set(['inaccuracy', 'mistake', 'miss', 'blunder']),
};

export interface GeneratePuzzlesOptions {
  severity?: BlunderSeverityFilter; // default 'mistake-and-blunder'
  sourceGameId?: string;
}

export interface GeneratePuzzlesResult {
  puzzles: Puzzle[];
  flaggedMoveCount: number;
}

// The reviewer already computes the best move from the position *before* a
// flagged move (ReviewedMove.bestMoveUci) — free to reuse for the
// avoid-blunder puzzle. It does not compute the opponent's best reply from
// the position *after* (that position is only ever evaluated as a "before"
// for the *next* ply), so punish-blunder needs one extra single-position
// engine query per flagged move.
async function findBestReply(fen: string): Promise<string | null> {
  if (new Chess(fen).isGameOver()) {
    devlog('tactics', 'punish-blunder skipped: position is game-over', { fen });
    return null; // nothing to punish — mate/stalemate ended it
  }
  try {
    devlog('tactics', 'punish-blunder: querying engine for refutation', { fen, depth: PASS2_DEPTH });
    const [top] = await engineService.evaluateMulti(fen, PASS2_DEPTH, 1);
    devlog('tactics', 'punish-blunder: engine result', { fen, uci: top?.pv[0] ?? null, score: top?.score, mate: top?.mate });
    return top?.pv[0] ?? null;
  } catch (err) {
    devlog('tactics', 'punish-blunder: engine query failed', { fen, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function generatePuzzlesFromReview(
  review: GameReview,
  options: GeneratePuzzlesOptions = {},
): Promise<GeneratePuzzlesResult> {
  const severity = options.severity ?? 'mistake-and-blunder';
  const wanted = SEVERITY_SETS[severity];
  const flagged = review.moves.filter((m) => !m.unscored && wanted.has(m.quality));

  devlog('tactics', 'generatePuzzlesFromReview: start', {
    severity, totalMoves: review.moves.length, sourceGameId: options.sourceGameId,
  });
  devlog('tactics', `filtered to ${flagged.length} flagged moves`, {
    moveIndices: flagged.map((m) => m.moveIndex),
    qualities: flagged.map((m) => m.quality),
  });

  const puzzles: Puzzle[] = [];
  for (const move of flagged) {
    const createdAt = Date.now();

    if (move.bestMoveUci) {
      devlog('tactics', `avoid-blunder puzzle: move ${move.moveIndex}`, {
        fen: move.fenBefore, solutionUci: move.bestMoveUci, severity: move.quality, winPctLoss: move.winPctLoss,
      });
      puzzles.push({
        id: nanoid(),
        fen: move.fenBefore,
        solutionUci: move.bestMoveUci,
        kind: 'avoid-blunder',
        sourceGameId: options.sourceGameId,
        sourcePly: move.moveIndex,
        severity: move.quality,
        winPctLoss: move.winPctLoss,
        createdAt,
      });
    }

    const refutationUci = await findBestReply(move.fenAfter);
    if (refutationUci) {
      devlog('tactics', `punish-blunder puzzle: move ${move.moveIndex}`, {
        fen: move.fenAfter, solutionUci: refutationUci, severity: move.quality, winPctLoss: move.winPctLoss,
      });
      puzzles.push({
        id: nanoid(),
        fen: move.fenAfter,
        solutionUci: refutationUci,
        kind: 'punish-blunder',
        sourceGameId: options.sourceGameId,
        sourcePly: move.moveIndex,
        severity: move.quality,
        winPctLoss: move.winPctLoss,
        createdAt,
      });
    }
  }

  if (puzzles.length > 0) {
    await db.puzzles.bulkAdd(puzzles);
    await db.leitnerBoxes.bulkAdd(puzzles.map((p) => ({
      puzzleId: p.id,
      box: 0,
      lastSessionNum: 0,
      rightCount: 0,
      wrongCount: 0,
    })));
    devlog('tactics', 'persisted to dexie', { puzzles: puzzles.length, leitnerBoxes: puzzles.length });
  }

  devlog('tactics', 'generatePuzzlesFromReview: done', {
    puzzleCount: puzzles.length, flaggedMoveCount: flagged.length,
  });

  return { puzzles, flaggedMoveCount: flagged.length };
}
