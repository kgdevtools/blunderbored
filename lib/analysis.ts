import { Chess } from 'chess.js';
import { engineService, EngineMultiLine } from './engine';
import type { KmapsResult } from './kmaps';
import {
  MoveQuality,
  QUALITY_META,
  ACCURACY_EXCLUDED,
  winP,
  winPctLossForSide,
  moveAccuracy,
  classifyQuality,
} from './accuracy';
import {
  classifyPhase,
  classifyMove,
  selectCriticals,
  detectSacrifice,
  countLegalMoves,
  type CriticalInput,
  type GamePhase,
} from './classification';
import { getBookMoves, ensureBookLoaded, isBookAvailable } from './polyglot';
import {
  ensureOpeningsLoaded,
  isOpeningsAvailable,
  isBookPosition,
  openingForGame,
  type OpeningInfo,
} from './openings';

export type { KmapsResult };
export type { MoveQuality };
export type { GamePhase };
export type { OpeningInfo };
export { QUALITY_META, classifyPhase };

// ── Types ─────────────────────────────────────────────────────────────────────

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
  // The engine's full principal variation from fenBefore (UCI), best move
  // first — the winning line. Stored so puzzle extraction can replay a real
  // solution VARIATION instead of a single move. Optional: v2 stored reviews
  // lack it (schema bump below invalidates them).
  bestLineUci?: string[];
  // The deep pass's second-best line (only present where pass 2 ran, i.e.
  // critical moves — which is exactly the set the puzzle move picker offers).
  // Optional: v3 stored reviews lack it.
  bestLineUci2?: string[];
  quality:      MoveQuality;
  cpLoss:       number;   // >= 0, from moving side's perspective
  winPctLoss:   number;   // 0–100
  moveAccuracy: number;   // 0–100
  isBook:       boolean;
  best?:        boolean;  // played the engine's top move (not book)
  missedMate?:  boolean;  // a forced mate was available but let go
  unscored?:    boolean;  // an endpoint eval failed — excluded from stats
  deep?:        boolean;  // refined by the MultiPV-2 deep pass
  kmaps?:       KmapsResult; // no longer computed on the hot path (lazy, on demand)
}

export interface SideSummary {
  accuracy: number;
  counts:   Record<MoveQuality, number>;
}

// Provenance stamped on every review; the persistence layer keys on it.
export interface ReviewMeta {
  version:     number;
  scanDepth:   number;
  deepDepth:   number;
  generatedAt: number;
}
export const REVIEW_SCHEMA_VERSION = 4; // v4: ReviewedMove.bestLineUci2 (second variation)

export interface GameReview {
  moves:        ReviewedMove[];
  whiteSummary: SideSummary;
  blackSummary: SideSummary;
  opening?:     OpeningInfo | null;
  meta?:        ReviewMeta;
}

// Structured run-log event, streamed to the UI while a review runs.
export interface ReviewLogEvent {
  ts:    number;                      // ms since analysis start
  level: 'info' | 'warn' | 'error';
  msg:   string;
}
export type ReviewLogFn = (e: ReviewLogEvent) => void;

// Two-phase progress: 'scan' covers every position, 'deep' only criticals.
export interface ReviewProgress {
  phase:   'scan' | 'deep';
  current: number;
  total:   number;
}
export type ReviewProgressFn = (p: ReviewProgress) => void;

// A move whose analysis just completed, streamed live while the review runs —
// drives the humanized run log ("26. Bh4 ! +1.3 Best") and the background
// board replay (position + glyph + best-move arrow) behind the modal.
// Quality here is PROVISIONAL (book detection and the full classifier run at
// the end); deep-pass refinements re-emit the same moveIndex with phase 'deep'.
export interface LiveMoveEvent {
  ts:          number;             // ms since analysis start
  phase:       'scan' | 'deep';
  moveIndex:   number;             // ply index (0-based)
  moveNum:     number;             // full-move number (1-based)
  color:       'w' | 'b';
  san:         string;
  fenBefore:   string;
  fenAfter:    string;
  evalAfterCp: number;             // White-POV
  quality:     MoveQuality;
  bestUci:     string;             // engine's best move from fenBefore
  bestLineSan: string[];           // best line as SANs (display-trimmed)
}
export type ReviewMoveFn = (m: LiveMoveEvent) => void;

// ── Engine budget ─────────────────────────────────────────────────────────────
// Pass 1 scans every position shallow/single-line in REVERSE order (the
// engine's transposition table still holds position i+1's subtree when i is
// searched — faster and more consistent, same trick En Croissant documents).
// Pass 2 revisits only critical positions deep with MultiPV 2.
export const PASS1_DEPTH = 12;
// engine-lab/run-multipv.mjs spike (2026-07-15): d18/pv2 = zero crashes on the
// shipped WASM binary at Hash 4 (the old "safe depth 14" was a MultiPV-3
// measurement). d16 is ~3.3× faster if pace ever matters more than depth.
export const PASS2_DEPTH = 18;
export const PASS2_MULTIPV = 2;

// Per-move centipawn loss is capped so a single mate-related swing (±10000
// internally) doesn't nuke the ACPL average — matches Lichess practice.
const CP_LOSS_CAP = 1000;
// Missed-mate gate: a forced mate in ≤ this many moves counts as "on".
const MATE_BOUND = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampCp(line: EngineMultiLine): number {
  if (line.mate !== null) return line.mate > 0 ? 10000 : -10000;
  return line.score;
}

// Stockfish UCI reports scores from the side-to-move's perspective.
// Negate when it's Black's turn to get a consistent White-positive convention.
function toWhiteCp(cp: number, fen: string): number {
  return fen.split(' ')[1] === 'b' ? -cp : cp;
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

// Convert an engine PV (UCI list) to SANs, stopping at the first illegal move
// (truncated/corrupt PVs happen on interrupted searches).
function pvToSan(fen: string, pv: string[], maxPlies = 8): string[] {
  const sans: string[] = [];
  try {
    const chess = new Chess(fen);
    for (const uci of pv.slice(0, maxPlies)) {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
      });
      if (!move) break;
      sans.push(move.san);
    }
  } catch { /* stop at first illegal */ }
  return sans;
}

// One evaluated position. cpWhite is clamped + White-POV; mateForMover is the
// engine's mate distance from the side-to-move's POV (0 = side to move IS
// checkmated — synthesized, never engine-reported).
interface EvalPoint {
  cpWhite:      number;
  mateForMover: number | null;
  bestUci:      string;
  pv:           string[];
  // pv here (unlike the top line's `pv` above) is only ever populated by the
  // deep pass (MultiPV 2) — the puzzle-generation move-variation picker's
  // second option, when one exists.
  line2?:       { cpWhite: number; mateForMover: number | null; pv: string[] };
  depth:        number;
  unscored?:    boolean;
  synthetic?:   boolean;
}

function toEvalPoint(lines: EngineMultiLine[], fen: string, depth: number): EvalPoint {
  const top = lines[0];
  const second = lines[1];
  return {
    cpWhite:      toWhiteCp(clampCp(top), fen),
    mateForMover: top.mate,
    bestUci:      top.pv[0] ?? '',
    pv:           top.pv,
    line2: second
      ? { cpWhite: toWhiteCp(clampCp(second), fen), mateForMover: second.mate, pv: second.pv }
      : undefined,
    depth,
  };
}

// Terminal positions are synthesized, never sent to the engine: Stockfish
// reports "mate 0" from the MATED side's POV there (or nothing at all), which
// a naive conversion turns into a phantom blunder on the mating move.
function terminalEvalPoint(fen: string): EvalPoint | null {
  const chess = new Chess(fen);
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) {
    return {
      cpWhite: chess.turn() === 'w' ? -10000 : 10000,
      mateForMover: 0,
      bestUci: '', pv: [], depth: 0, synthetic: true,
    };
  }
  // Stalemate / insufficient material / 50-move / threefold
  return { cpWhite: 0, mateForMover: null, bestUci: '', pv: [], depth: 0, synthetic: true };
}

const UNSCORED_POINT: Omit<EvalPoint, 'cpWhite'> & { cpWhite: number } = {
  cpWhite: 0, mateForMover: null, bestUci: '', pv: [], depth: 0, unscored: true,
};

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function analyseGame(
  pgn: string,
  onProgress?: ReviewProgressFn,
  onLog?: ReviewLogFn,
  onMove?: ReviewMoveFn,
): Promise<GameReview> {
  const t0 = performance.now();
  const log = (level: ReviewLogEvent['level'], msg: string) => {
    onLog?.({ ts: Math.round(performance.now() - t0), level, msg });
    if (level !== 'info') console.warn(`[reviewer] ${msg}`);
  };

  // Book sources, best-first: polyglot .bin (optional drop-in) → ECO dataset →
  // file-free opening heuristic.
  await Promise.all([ensureOpeningsLoaded(), ensureBookLoaded()]);
  const bookSrc = isBookAvailable() ? 'polyglot .bin'
    : isOpeningsAvailable() ? 'ECO dataset'
    : 'opening heuristic (no dataset)';

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

  log('info', `parsed ${moves.length} moves (${total} positions) · scan d${PASS1_DEPTH} → deep d${PASS2_DEPTH}/pv${PASS2_MULTIPV} · book: ${bookSrc}`);

  // Emit a live per-move event once BOTH endpoints of move i are evaluated.
  // Pass 1 runs in reverse, so when position i lands, position i+1 already
  // has — every scanned position completes exactly one move (except the last).
  const emitMove = (i: number, phase: 'scan' | 'deep') => {
    if (!onMove || i < 0 || i >= moves.length) return;
    const before = points[i];
    const after = points[i + 1];
    if (!before || !after || before.unscored || after.unscored) return;
    const m = moves[i];
    const color = m.color as 'w' | 'b';
    const playedUci = m.from + m.to + (m.promotion ?? '');
    const { winPctLoss } = winPctLossForSide(before.cpWhite, after.cpWhite, color);
    const playedIsBest = before.bestUci !== '' && before.bestUci === playedUci;
    onMove({
      ts: Math.round(performance.now() - t0),
      phase,
      moveIndex: i,
      moveNum: Math.floor(i / 2) + 1,
      color,
      san: m.san,
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      evalAfterCp: after.cpWhite,
      quality: playedIsBest ? 'best' : classifyQuality(Math.max(0, winPctLoss)),
      bestUci: before.bestUci,
      bestLineSan: pvToSan(fens[i], before.pv),
    });
  };

  // ── Pass 1: reverse shallow scan ──────────────────────────────────────────
  const points: EvalPoint[] = new Array(total);
  let evalFailures = 0;
  const tScan = performance.now();
  for (let i = total - 1; i >= 0; i--) {
    const done = total - i;
    onProgress?.({ phase: 'scan', current: done, total });
    const synthetic = terminalEvalPoint(fens[i]);
    if (synthetic) {
      points[i] = synthetic;
      continue;
    }
    let lines: EngineMultiLine[] | null = null;
    for (let attempt = 0; attempt < 2 && !lines; attempt++) {
      try {
        lines = await engineService.evaluateMulti(fens[i], PASS1_DEPTH, 1);
      } catch {
        if (attempt === 1) {
          points[i] = { ...UNSCORED_POINT };
          evalFailures++;
          log('warn', `scan failed twice on position ${i} — marked unscored (move ${Math.ceil(i / 2)} excluded from stats)`);
        }
      }
    }
    if (lines) points[i] = toEvalPoint(lines, fens[i], PASS1_DEPTH);
    emitMove(i, 'scan'); // move i just became fully evaluated (reverse order)
    if (done % 10 === 0 || done === total) {
      const msPer = (performance.now() - tScan) / done;
      log('info', `scanned ${done}/${total} positions · ${msPer.toFixed(0)}ms/pos avg`);
    }
  }

  // ── Book detection + provisional classification (engine-free) ─────────────
  const isBookMove: boolean[] = new Array(moves.length).fill(false);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const playedUci = m.from + m.to + (m.promotion ?? '');
    const gameOver = points[i + 1]?.synthetic === true;
    if (gameOver) continue; // a game-ending move is never "theory"
    if (isBookAvailable()) {
      isBookMove[i] = (await getBookMoves(fens[i])).includes(playedUci);
    } else if (isOpeningsAvailable()) {
      isBookMove[i] = isBookPosition(fens[i + 1]);
    } else {
      const color = m.color as 'w' | 'b';
      const { winPctLoss } = winPctLossForSide(points[i].cpWhite, points[i + 1].cpWhite, color);
      isBookMove[i] = classifyPhase(fens[i]) === 'opening' && i < 16 && Math.max(0, winPctLoss) < 5;
    }
  }
  const opening = openingForGame(fens);
  if (opening) log('info', `opening: ${opening.eco} ${opening.name}`);

  const criticalInputs: CriticalInput[] = moves.map((m, i) => {
    const color = m.color as 'w' | 'b';
    const before = points[i];
    const after = points[i + 1];
    const playedUci = m.from + m.to + (m.promotion ?? '');
    const { winPctLoss } = winPctLossForSide(before.cpWhite, after.cpWhite, color);
    const provisional: MoveQuality = isBookMove[i] ? 'book' : classifyQuality(Math.max(0, winPctLoss));
    return {
      provisional,
      mateInvolved: before.mateForMover !== null || after.mateForMover !== null,
      playedIsBest: before.bestUci !== '' && before.bestUci === playedUci,
      swingCp: Math.abs(after.cpWhite - before.cpWhite),
      sacrificeCandidate:
        before.bestUci === playedUci && detectSacrifice(fens[i], before.pv),
      unscored: before.unscored === true || after.unscored === true,
    };
  });

  // ── Pass 2: deep MultiPV-2 on critical positions, reverse order ───────────
  const criticalMoves = selectCriticals(criticalInputs);
  const positionSet = new Set<number>();
  for (const i of criticalMoves) {
    if (!points[i].synthetic) positionSet.add(i);
    if (!points[i + 1].synthetic) positionSet.add(i + 1);
  }
  const deepPositions = [...positionSet].sort((a, b) => b - a);
  log('info', `deep pass: ${criticalMoves.length}/${moves.length} critical moves → ${deepPositions.length} positions`);

  const tDeep = performance.now();
  let deepDone = 0;
  for (const i of deepPositions) {
    onProgress?.({ phase: 'deep', current: ++deepDone, total: deepPositions.length });
    // Failure ladder: retry full depth → shallow pv2 → keep the pass-1 point
    // (the engine watchdog respawns a crashed worker between attempts).
    const ladder: Array<[number, number]> = [
      [PASS2_DEPTH, PASS2_MULTIPV],
      [PASS2_DEPTH, PASS2_MULTIPV],
      [PASS1_DEPTH, PASS2_MULTIPV],
    ];
    for (const [depth, pvCount] of ladder) {
      try {
        const lines = await engineService.evaluateMulti(fens[i], depth, pvCount);
        points[i] = toEvalPoint(lines, fens[i], depth);
        break;
      } catch {
        /* next rung */
      }
    }
    if (points[i].depth < PASS2_DEPTH && !points[i].unscored) {
      log('warn', `deep pass degraded on position ${i} (kept d${points[i].depth})`);
    }
    emitMove(i, 'deep'); // refined verdict for the move played from this position
    if (deepDone % 10 === 0 || deepDone === deepPositions.length) {
      const msPer = (performance.now() - tDeep) / deepDone;
      log('info', `deep ${deepDone}/${deepPositions.length} positions · ${msPer.toFixed(0)}ms/pos avg`);
    }
  }
  if (evalFailures) log('warn', `${evalFailures} position(s) could not be evaluated`);

  // ── Final classification ───────────────────────────────────────────────────
  const reviewed: ReviewedMove[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const color = m.color as 'w' | 'b';
    const before = points[i];
    const after = points[i + 1];
    const fenBefore = fens[i];
    const fenAfter = fens[i + 1];
    const unscored = before.unscored === true || after.unscored === true;

    const evalBefore = before.cpWhite;
    const evalAfter = after.cpWhite;
    const { wpBefore, wpAfter, winPctLoss } = winPctLossForSide(evalBefore, evalAfter, color);
    const wpl = Math.max(0, winPctLoss);
    const cpLoss = Math.min(CP_LOSS_CAP,
      Math.max(0, color === 'w' ? evalBefore - evalAfter : evalAfter - evalBefore));
    const accuracy = moveAccuracy(wpBefore, wpAfter);

    const playedUci = m.from + m.to + (m.promotion ?? '');
    const bestMoveUci = before.bestUci;
    const playedIsBest = bestMoveUci !== '' && bestMoveUci === playedUci;
    const bestMoveSan = (bestMoveUci && !playedIsBest) ? uciToSan(fenBefore, bestMoveUci) : '';

    // Mover-POV win% of the deep pass's two lines (only where pass 2 ran).
    const line1Wp = before.line2
      ? (color === 'w' ? winP(before.cpWhite) : winP(-before.cpWhite))
      : undefined;
    const line2Wp = before.line2
      ? (color === 'w' ? winP(before.line2.cpWhite) : winP(-before.line2.cpWhite))
      : undefined;

    // Missed forced mate: mate ≤ MATE_BOUND was on for the mover and the move
    // let it slip. mateForMover ≤ 0 after = the opponent (now to move) is
    // getting mated / is mated — the mate was kept.
    const hadMate = before.mateForMover !== null
      && before.mateForMover > 0 && before.mateForMover <= MATE_BOUND;
    const keptMate = after.mateForMover !== null && after.mateForMover <= 0;
    const missedMate = hadMate && !keptMate && !playedIsBest;

    const quality: MoveQuality = unscored
      ? 'good' // neutral placeholder; excluded from all stats below
      : classifyMove({
          winPctLoss: wpl,
          wpBefore,
          wpAfter,
          playedIsBest,
          isBook: isBookMove[i],
          legalMoveCount: countLegalMoves(fenBefore),
          missedMate,
          isSacrifice: playedIsBest && detectSacrifice(fenBefore, before.pv),
          line1Wp,
          line2Wp,
        });

    reviewed.push({
      moveIndex:    i,
      moveSan:      m.san,
      color,
      phase:        classifyPhase(fenBefore),
      fenBefore,
      fenAfter,
      evalBefore,
      evalAfter,
      bestMoveSan,
      bestMoveUci,
      bestLineUci:  before.pv.length > 0 ? [...before.pv] : undefined,
      bestLineUci2: before.line2?.pv?.length ? [...before.line2.pv] : undefined,
      quality,
      cpLoss,
      winPctLoss:   wpl,
      moveAccuracy: accuracy,
      isBook:       isBookMove[i],
      best:         playedIsBest && !isBookMove[i],
      missedMate,
      unscored:     unscored || undefined,
      deep:         before.line2 !== undefined || undefined,
    });
  }

  const whiteSummary = buildSideSummary(reviewed, 'w');
  const blackSummary = buildSideSummary(reviewed, 'b');
  const tally = (s: SideSummary) =>
    `${s.accuracy.toFixed(1)}% · ${s.counts.inaccuracy} inacc, ${s.counts.mistake} mistakes, ${s.counts.miss} misses, ${s.counts.blunder} blunders`;
  log('info', `classified ${reviewed.length} moves in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  log('info', `White ${tally(whiteSummary)}`);
  log('info', `Black ${tally(blackSummary)}`);

  return {
    moves: reviewed,
    whiteSummary,
    blackSummary,
    opening,
    meta: {
      version: REVIEW_SCHEMA_VERSION,
      scanDepth: PASS1_DEPTH,
      deepDepth: PASS2_DEPTH,
      generatedAt: Date.now(),
    },
  };
}

function buildSideSummary(moves: ReviewedMove[], side: 'w' | 'b'): SideSummary {
  const sideMoves = moves.filter(m => m.color === side && !m.unscored);
  const scored = sideMoves.filter(m => !ACCURACY_EXCLUDED.has(m.quality));

  const accuracy = scored.length === 0
    ? 100
    : scored.reduce((s, m) => s + m.moveAccuracy, 0) / scored.length;

  const counts: Record<MoveQuality, number> = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0,
    inaccuracy: 0, mistake: 0, miss: 0, blunder: 0, forced: 0,
  };
  for (const m of sideMoves) counts[m.quality]++;

  return { accuracy, counts };
}
