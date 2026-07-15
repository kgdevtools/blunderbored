// Pure logic for the /blunderable challenge: eval orientation, the dynamic
// move classifier, the engine's "random top-3 non-blunder" reply pick, and the
// success-trend test. No engine I/O here — callers pass in engine results.

// .ts extension so this pure module runs under Node's type-stripping in the
// scripts/engine-lab test harnesses (same pattern as lib/classification.ts).
import { Chess } from 'chess.js';
import { winP } from './accuracy.ts';

export type MoveClass = 'ok' | 'inaccuracy' | 'mistake' | 'blunder';

// UCI scores are from the side-to-move's perspective; flip on Black's turn to a
// White-positive convention (matches lib/analysis.ts).
export function toWhiteCp(score: number, fen: string): number {
  return fen.split(' ')[1] === 'b' ? -score : score;
}

// White-POV centipawns → the given side's POV.
export function evalForSide(whiteCp: number, side: 'w' | 'b'): number {
  return side === 'w' ? whiteCp : -whiteCp;
}

// ─── Win%-based scoring ───────────────────────────────────────────────────────
// We score in win-probability (Lichess sigmoid), not raw centipawns: a half-pawn
// slip when you're +0.3 matters far more than the same slip when you're +6, and
// win% captures that where a flat cp threshold can't.
//
// "Self-loss" is the damage YOUR move did, measured BEFORE the engine replies:
//   selfLossWp = winP(beforeYourMove) − winP(afterYourMove)   (both player-POV).
// This isolates your contribution from whatever the engine does next.

// Win% drop on a single player move that ends the run immediately.
export const SELF_BLUNDER_WP = 15;
// Mistake / inaccuracy bands (for the end-of-run report only).
export const SELF_MISTAKE_WP = 10;
export const SELF_INACC_WP = 5;
// Cumulative self-inflicted win% loss across the run that fails by "drift" —
// death by a thousand cuts, even without a single outright blunder.
export const CUMULATIVE_FAIL_WP = 20;

// ── Regression fail (v2) ──────────────────────────────────────────────────────
// "Don't make the position gradually worse": looking at the last WINDOW player
// moves, the run fails if the position declined on at least MIN_DECLINES of
// them AND the window's total self-loss reaches WINDOW_WP. Catches the steady
// 3–4-move bleed that is too slow for the single-blunder gate and too recent
// for the cumulative gate.
export const REGRESSION_WINDOW = 4;
export const REGRESSION_MIN_DECLINES = 3;
export const REGRESSION_WINDOW_WP = 12;
// A move counts as "declined" if it lost at least this much win%. 2.5 sits
// above 600k-node scoring jitter (~1–2wp on fine moves) — at the old 1wp,
// noise-level entries counted as declines and "one inaccuracy + noise" could
// masquerade as a trend (verified against a live run 2026-07-15).
export const REGRESSION_DECLINE_EPS_WP = 2.5;

// `selfLosses` = per-player-move self-inflicted win% losses, in play order.
// Fires only while the bleed is CURRENT (the latest move itself declined) —
// a slide that already stopped shouldn't fail you retroactively, and this
// doubles as hysteresis against boundary flips from scoring noise; a resumed
// slide re-arms the gate on the next declining move.
export function regressionFail(selfLosses: number[]): boolean {
  if (selfLosses.length < REGRESSION_WINDOW) return false;
  const win = selfLosses.slice(-REGRESSION_WINDOW);
  const declines = win.filter((l) => l >= REGRESSION_DECLINE_EPS_WP).length;
  const total = win.reduce((a, b) => a + b, 0);
  const currentDecline = win[win.length - 1] >= REGRESSION_DECLINE_EPS_WP;
  return currentDecline && declines >= REGRESSION_MIN_DECLINES && total >= REGRESSION_WINDOW_WP;
}

// ── Missed win (v2) ───────────────────────────────────────────────────────────
// A badge (not a fail state — big drops usually trip a class anyway): the
// position was winning and your move let it out of the decisive band.
export const MISSED_WIN_FROM_WP = 80;
export const MISSED_WIN_TO_WP = 65;

export function isMissedWin(wpBefore: number, wpAfter: number): boolean {
  return wpBefore >= MISSED_WIN_FROM_WP && wpAfter < MISSED_WIN_TO_WP;
}

// Player-POV centipawns → player win% (0–100). winP is symmetric about 0, so a
// player-POV score maps straight to the player's own win probability.
export function winPForPlayer(playerCp: number): number {
  return winP(playerCp);
}

// Classify a single move by its self-inflicted win% loss.
export function classifySelfLoss(wpLoss: number): MoveClass {
  if (wpLoss >= SELF_BLUNDER_WP) return 'blunder';
  if (wpLoss >= SELF_MISTAKE_WP) return 'mistake';
  if (wpLoss >= SELF_INACC_WP) return 'inaccuracy';
  return 'ok';
}

export const CLASS_META: Record<MoveClass, { label: string; color: string; glyph: string }> = {
  ok: { label: 'OK', color: '#a1a1aa', glyph: '' },
  inaccuracy: { label: 'Inaccuracy', color: '#facc15', glyph: '?!' },
  mistake: { label: 'Mistake', color: '#fb923c', glyph: '?' },
  blunder: { label: 'Blunder', color: '#ef4444', glyph: '??' },
};

export interface BlunderMove {
  notation: string;  // real move notation, e.g. "1. Ne4" or "3… Bg5"
  cls: MoveClass;
  wpLoss?: number;   // self-inflicted win% loss for this move (current model)
  evalCp?: number;   // player-POV eval (cp) right after your move, pre-reply
  deltaCp?: number;  // legacy: player-POV eval drop (cp) — older saved records
  cpLoss?: number;   // self-inflicted centipawn loss (v2 — feeds the quality line)
  missedWin?: boolean; // was winning (≥80wp) and dropped out of the band (v2)
  clockMs: number;   // time the player spent on the move
  san?: string;      // bare SAN of your move (for the side-by-side report)
  engineSan?: string;    // the engine's reply SAN
  engineEvalCp?: number; // player-POV eval (cp) after the engine's reply
  bestSan?: string;      // the engine's recommended move for you, when you missed it
}

// ─── Time-spent classification ────────────────────────────────────────────────
// Time on the clock is a strong signal of where you struggled. Thresholds are
// calibrated to a 3-minute (180s) game — >15s is worth noting, 20s is a key
// decision, >30s means you were genuinely struggling, and a very long think
// flags the position as worth studying afterwards — then scaled to the actual
// time control so the bands stay proportional at 5 and 10 minutes.
export type TimeClass = 'quick' | 'noted' | 'key' | 'struggling' | 'study';

export const TIME_META: Record<TimeClass, { label: string; color: string }> = {
  quick:      { label: '',            color: '#71717a' }, // zinc-500
  noted:      { label: 'slow',        color: '#facc15' }, // yellow
  key:        { label: 'key moment',  color: '#fb923c' }, // orange
  struggling: { label: 'struggling',  color: '#ef4444' }, // red
  study:      { label: 'study this',  color: '#a855f7' }, // purple
};

export interface TimeBands { noted: number; key: number; struggling: number; study: number; }

// Seconds thresholds scaled from the 180s baseline (15 / 20 / 30 / 45s).
export function timeBands(clockInitialMs: number): TimeBands {
  const base = Math.max(1, clockInitialMs / 1000);
  return { noted: base / 12, key: base / 9, struggling: base / 6, study: base / 4 };
}

export function classifyMoveTime(clockMs: number, clockInitialMs: number): TimeClass {
  const s = clockMs / 1000;
  const b = timeBands(clockInitialMs);
  if (s >= b.study) return 'study';
  if (s >= b.struggling) return 'struggling';
  if (s >= b.key) return 'key';
  if (s >= b.noted) return 'noted';
  return 'quick';
}

// Move notation from the fullmove number (of the position before the move) and
// the moving colour: "12. Ne4" for White, "12… Bg5" for Black.
export function moveNotation(fullmoveBefore: number, color: 'w' | 'b', san: string): string {
  return `${fullmoveBefore}${color === 'w' ? '.' : '…'} ${san}`;
}

// ─── Threat detection (fail-state arrows) ─────────────────────────────────────

export interface ThreatArrow { from: string; to: string; color: string; kind: 'hanging' | 'capture' | 'check'; }

export const THREAT_COLORS = {
  hanging: 'rgba(239,68,68,0.9)',  // red — your piece is en prise
  capture: 'rgba(34,197,94,0.85)', // green — a capture you can make
  check: 'rgba(59,130,246,0.85)',  // blue — a checking move
};

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// Reads the frozen position (side-to-move = the player) and surfaces, as arrows:
// the player's hanging pieces (attacker → piece), available captures, and checks.
// A light, defensive heuristic — meant as a "here's what mattered" hint, not a
// solver. Capped so the board stays readable.
export function detectThreats(fen: string): ThreatArrow[] {
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return []; }
  const me = chess.turn();
  const opp = me === 'w' ? 'b' : 'w';
  const arrows: ThreatArrow[] = [];
  const used = new Set<string>();

  // Hanging own pieces: attacked by the opponent and either under-defended or
  // attacked by something cheaper than the piece itself.
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== me) continue;
      const attackers = chess.attackers(sq.square, opp);
      if (attackers.length === 0) continue;
      const defenders = chess.attackers(sq.square, me);
      const minAttacker = Math.min(...attackers.map((a) => PIECE_VALUE[chess.get(a)?.type ?? 'p']));
      if (attackers.length > defenders.length || minAttacker < PIECE_VALUE[sq.type]) {
        arrows.push({ from: attackers[0], to: sq.square, color: THREAT_COLORS.hanging, kind: 'hanging' });
        used.add(attackers[0] + sq.square);
      }
    }
  }

  const legal = chess.moves({ verbose: true });
  for (const m of legal) {
    const key = m.from + m.to;
    if (m.captured && !used.has(key)) { arrows.push({ from: m.from, to: m.to, color: THREAT_COLORS.capture, kind: 'capture' }); used.add(key); }
  }
  for (const m of legal) {
    const key = m.from + m.to;
    if (m.san.includes('+') && !used.has(key)) { arrows.push({ from: m.from, to: m.to, color: THREAT_COLORS.check, kind: 'check' }); used.add(key); }
  }

  return arrows.slice(0, 8);
}
