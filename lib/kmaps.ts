import { Chess } from 'chess.js';

export interface KmapsResult {
  kingSafety:    string | null;
  activity:      string | null;
  pawnStructure: string | null;
  space:         string | null;
}

type BoardCell = null | { type: string; color: string };
type Board = BoardCell[][];

export function kmapsAnalyse(fen: string): KmapsResult {
  return {
    kingSafety:    analyseKingSafety(fen),
    activity:      analyseActivity(fen),
    pawnStructure: analysePawnStructure(fen),
    space:         analyseSpace(fen),
  };
}

// ── King Safety ───────────────────────────────────────────────────────────────

function analyseKingSafety(fen: string): string | null {
  const board = new Chess(fen).board() as Board;
  return kingNote(board, 'w') ?? kingNote(board, 'b');
}

function kingNote(board: Board, color: 'w' | 'b'): string | null {
  const king = findKingSquare(board, color);
  if (!king) return null;

  const { row, col } = king;
  const side = color === 'w' ? 'White' : 'Black';

  // Only check castled / side-positioned kings
  if (col > 2 && col < 5) return null;

  // Count missing shield pawns in the row directly in front
  const shieldRow = color === 'w' ? row - 1 : row + 1;
  let missing = 0;
  if (shieldRow >= 0 && shieldRow <= 7) {
    for (const f of [Math.max(0, col - 1), col, Math.min(7, col + 1)]) {
      const p = board[shieldRow][f];
      if (!p || p.type !== 'p' || p.color !== color) missing++;
    }
  } else {
    missing = 3;
  }

  if (missing >= 2) {
    return `${side} king exposed — weak pawn shield on ${fileLetter(col)}-file`;
  }

  if (isOpenFile(board, col)) {
    return `${side} king on open ${fileLetter(col)}-file`;
  }

  return null;
}

function findKingSquare(board: Board, color: 'w' | 'b'): { row: number; col: number } | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

function isOpenFile(board: Board, file: number): boolean {
  for (let r = 0; r < 8; r++) {
    const p = board[r][file];
    if (p && p.type === 'p') return false;
  }
  return true;
}

// ── Activity / Mobility ───────────────────────────────────────────────────────

function analyseActivity(fen: string): string | null {
  const parts = fen.split(' ');
  const side = parts[1] as 'w' | 'b';

  let movingCount = 0;
  let otherCount = 0;

  try { movingCount = new Chess(fen).moves().length; } catch { return null; }

  try {
    const flipped = [parts[0], side === 'w' ? 'b' : 'w', parts[2], '-', parts[4] ?? '0', parts[5] ?? '1'].join(' ');
    otherCount = new Chess(flipped).moves().length;
  } catch { return null; }

  const wMoves = side === 'w' ? movingCount : otherCount;
  const bMoves = side === 'b' ? movingCount : otherCount;
  const diff = wMoves - bMoves;

  if (Math.abs(diff) <= 5) return null;
  const ahead = diff > 0 ? 'White' : 'Black';
  return `${ahead} has significant mobility advantage (${Math.max(wMoves, bMoves)} vs ${Math.min(wMoves, bMoves)} moves)`;
}

// ── Pawn Structure ────────────────────────────────────────────────────────────

interface PawnSq { file: number; rank: number } // rank 0 = rank-1 (bottom)

function analysePawnStructure(fen: string): string | null {
  const board = new Chess(fen).board() as Board;
  const wp: PawnSq[] = [];
  const bp: PawnSq[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (!p || p.type !== 'p') continue;
      const rank = 7 - row;
      if (p.color === 'w') wp.push({ file: col, rank });
      else                  bp.push({ file: col, rank });
    }
  }

  const wByFile = groupByFile(wp);
  const bByFile = groupByFile(bp);

  // Passed (highest priority)
  for (const p of wp) {
    if (isPassed(p, bByFile, 'w')) return `Passed white pawn on ${fileLetter(p.file)}${p.rank + 1}`;
  }
  for (const p of bp) {
    if (isPassed(p, wByFile, 'b')) return `Passed black pawn on ${fileLetter(p.file)}${p.rank + 1}`;
  }

  // Isolated
  for (const [f] of wByFile) {
    if (!wByFile.has(f - 1) && !wByFile.has(f + 1)) return `Isolated white pawn on ${fileLetter(f)}-file`;
  }
  for (const [f] of bByFile) {
    if (!bByFile.has(f - 1) && !bByFile.has(f + 1)) return `Isolated black pawn on ${fileLetter(f)}-file`;
  }

  // Doubled
  for (const [f, ranks] of wByFile) {
    if (ranks.length > 1) return `Doubled white pawns on ${fileLetter(f)}-file`;
  }
  for (const [f, ranks] of bByFile) {
    if (ranks.length > 1) return `Doubled black pawns on ${fileLetter(f)}-file`;
  }

  return null;
}

function groupByFile(pawns: PawnSq[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const p of pawns) {
    const arr = m.get(p.file) ?? [];
    arr.push(p.rank);
    m.set(p.file, arr);
  }
  return m;
}

function isPassed(pawn: PawnSq, opponentByFile: Map<number, number[]>, color: 'w' | 'b'): boolean {
  for (const f of [pawn.file - 1, pawn.file, pawn.file + 1]) {
    const ranks = opponentByFile.get(f) ?? [];
    if (color === 'w' && ranks.some(r => r > pawn.rank)) return false;
    if (color === 'b' && ranks.some(r => r < pawn.rank)) return false;
  }
  return true;
}

// ── Space ─────────────────────────────────────────────────────────────────────

function analyseSpace(fen: string): string | null {
  const board = new Chess(fen).board() as Board;
  let wSpace = 0, bSpace = 0;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (!p) continue;
      if (p.color === 'w' && row <= 3) wSpace++; // White pieces in ranks 5–8
      if (p.color === 'b' && row >= 4) bSpace++; // Black pieces in ranks 1–4
    }
  }

  const diff = wSpace - bSpace;
  if (Math.abs(diff) <= 2) return null;
  return diff > 0 ? 'White controls more space' : 'Black has a spatial advantage';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileLetter(f: number): string {
  return String.fromCharCode(97 + f);
}
