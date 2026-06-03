import { Chess } from 'chess.js';
import { engineService, EngineMultiLine } from './engine';
import { kmapsAnalyse, KmapsResult } from './kmaps';
import {
  MoveQuality,
  QUALITY_META,
  winPctLossForSide,
  moveAccuracy,
  classifyQuality,
} from './accuracy';
import { getBookMoves, ensureBookLoaded, isBookAvailable } from './polyglot';

export type { KmapsResult };
export type { MoveQuality };
export { QUALITY_META };

// ── Types ─────────────────────────────────────────────────────────────────────

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface ReviewedMove {
  moveIndex:    number;
  moveSan:      string;
  color:        'w' | 'b';
  phase:        GamePhase;
  fenBefore:    string;
  fenAfter:     string;
  evalBefore:   number;   // cp, White's perspective
  evalAfter:    number;
  bestMoveSan:  string;   // '' when played move = best
  bestMoveUci:  string;
  quality:      MoveQuality;
  cpLoss:       number;   // >= 0, from moving side's perspective
  winPctLoss:   number;   // 0–100
  moveAccuracy: number;   // 0–100
  isBook:       boolean;
  best?:        boolean;  // played the engine's top move (not book)
  missedMate?:  boolean;  // a forced mate was available but let go
  kmaps:        KmapsResult;
}

export interface SideSummary {
  accuracy: number;
  counts:   Record<MoveQuality, number>;
}

export interface GameReview {
  moves:        ReviewedMove[];
  whiteSummary: SideSummary;
  blackSummary: SideSummary;
}

// ── Phase classifier ──────────────────────────────────────────────────────────

export function classifyPhase(fen: string): GamePhase {
  const count = (fen.split(' ')[0].match(/[PNBRQK]/gi) ?? []).length;
  if (count >= 20) return 'opening';
  if (count <= 12) return 'endgame';
  return 'middlegame';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampScore(line: EngineMultiLine): number {
  if (line.mate !== null) return line.mate > 0 ? 10000 : -10000;
  return line.score;
}

// Stockfish UCI reports scores from the side-to-move's perspective.
// Negate when it's Black's turn to get a consistent White-positive convention.
function normalizeToWhite(score: number, fen: string): number {
  return fen.split(' ')[1] === 'b' ? -score : score;
}

function uciToSan(fen: string, uci: string): string {
  if (!uci || uci.length < 4) return uci;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from:      uci.slice(0, 2),
      to:        uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
    });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function analyseGame(
  pgn: string,
  onProgress?: (current: number, total: number) => void,
): Promise<GameReview> {
  // Pre-load book (silent — falls back to heuristic if unavailable)
  await ensureBookLoaded();

  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });

  // Rewind to start position (handles [FEN "..."] header in PGN)
  while (chess.history().length > 0) chess.undo();

  // Collect N+1 FENs: start + after each move
  const fens: string[] = [chess.fen()];
  for (const m of moves) {
    chess.move(m.san);
    fens.push(chess.fen());
  }

  const total = fens.length;

  // Evaluate every position with single best-move line at depth 18
  const evals: EngineMultiLine[] = [];
  for (let i = 0; i < total; i++) {
    onProgress?.(i, total);
    try {
      const lines = await engineService.evaluateMulti(fens[i], 18, 1);
      evals.push(lines[0]);
    } catch {
      // On engine failure push a neutral placeholder so indices stay aligned
      evals.push({ rank: 1, score: 0, mate: null, depth: 0, pv: [] });
    }
  }

  // Build ReviewedMove array
  const reviewed: ReviewedMove[] = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const color = m.color as 'w' | 'b';
    const fenBefore = fens[i];
    const fenAfter  = fens[i + 1];
    const evalBefore = normalizeToWhite(clampScore(evals[i]),     fens[i]);
    const evalAfter  = normalizeToWhite(clampScore(evals[i + 1]), fens[i + 1]);
    const phase = classifyPhase(fenBefore);

    const { wpBefore, wpAfter, winPctLoss } = winPctLossForSide(evalBefore, evalAfter, color);
    const cpLoss = Math.max(0, color === 'w' ? evalBefore - evalAfter : evalAfter - evalBefore);
    const accuracy = moveAccuracy(wpBefore, wpAfter);

    // Best move
    const bestMoveUci = evals[i].pv[0] ?? '';
    const playedUci   = m.from + m.to + (m.promotion ?? '');
    const bestMoveSan = (bestMoveUci && bestMoveUci !== playedUci)
      ? uciToSan(fenBefore, bestMoveUci)
      : '';

    // Book detection. Primary: Polyglot .bin (exact). Fallback when the .bin
    // isn't loaded: a conservative, file-free heuristic — a near-best move still
    // in the opening is treated as theory rather than flagged. The .bin
    // supersedes this once shipped.
    let isBook = false;
    if (isBookAvailable()) {
      const bookMoves = await getBookMoves(fenBefore);
      isBook = bookMoves.includes(playedUci);
    } else if (phase === 'opening' && i < 16 && Math.max(0, winPctLoss) < 5) {
      isBook = true;
    }

    // Classify purely by win%-loss (Lichess-calibrated). The curve self-damps in
    // won positions (a 200cp swing at +9 is a ~3% drop), so no decided-position
    // suppression is needed — and real throws while winning are correctly flagged.
    const quality: MoveQuality = isBook
      ? 'book'
      : classifyQuality(Math.max(0, winPctLoss));

    // Positive label: played the engine's top move (and it isn't book). Free —
    // we already have the depth-18 best move.
    const best = !isBook && bestMoveUci !== '' && bestMoveUci === playedUci;

    // Missed forced mate: a mate (≤ N) was available before but the played move
    // let it slip. Mate sign is from the side-to-move's perspective.
    const MATE_BOUND = 10;
    const mateBefore = evals[i].mate;
    const mateAfter  = evals[i + 1].mate;
    const hadMate  = mateBefore != null && mateBefore > 0 && mateBefore <= MATE_BOUND;
    const keptMate = mateAfter  != null && mateAfter  < 0; // opponent (to move) is getting mated
    const missedMate = hadMate && !keptMate && !best;

    // K-MAPS on the resulting position
    const kmaps = kmapsAnalyse(fenAfter);

    reviewed.push({
      moveIndex:    i,
      moveSan:      m.san,
      color,
      phase,
      fenBefore,
      fenAfter,
      evalBefore,
      evalAfter,
      bestMoveSan,
      bestMoveUci,
      quality,
      cpLoss,
      winPctLoss:   Math.max(0, winPctLoss),
      moveAccuracy: accuracy,
      isBook,
      best,
      missedMate,
      kmaps,
    });
  }

  onProgress?.(total, total);

  return {
    moves:        reviewed,
    whiteSummary: buildSideSummary(reviewed, 'w'),
    blackSummary: buildSideSummary(reviewed, 'b'),
  };
}

function buildSideSummary(moves: ReviewedMove[], side: 'w' | 'b'): SideSummary {
  const sideMoves = moves.filter(m => m.color === side);
  const nonBook   = sideMoves.filter(m => !m.isBook);

  const accuracy = nonBook.length === 0
    ? 100
    : nonBook.reduce((s, m) => s + m.moveAccuracy, 0) / nonBook.length;

  const counts: Record<MoveQuality, number> = {
    book: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0,
  };
  for (const m of sideMoves) counts[m.quality]++;

  return { accuracy, counts };
}
