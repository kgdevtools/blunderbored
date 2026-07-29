// Batch-fetches puzzles directly from the Lichess API (not a pasted URL) —
// ported from lca-auth's academy lesson-puzzle importer. Requires
// LICHESS_API_TOKEN in .env.local.

import { NextResponse } from 'next/server';
import { fenAtPly, uciSolutionToSan } from '@/lib/lichessPuzzle';

const VALID_DIFFICULTIES = ['easiest', 'easier', 'normal', 'harder', 'hardest'] as const;
type Difficulty = typeof VALID_DIFFICULTIES[number];

// Full list of valid Lichess puzzle angles — used for random selection when themes=mixed.
const ALL_THEMES = [
  'caroKann', 'slavDefense', 'frenchDefense', 'sicilianDefense', 'italianGame',
  'spanishGame', 'kingsGambit', 'queensGambit', 'englishOpening', 'scotchGame',
  'viennaGame', 'kingIndianDefense', 'nimzoIndianDefense', 'dutchDefense',
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection',
  'hangingPiece', 'trappedPiece', 'attraction', 'interference', 'clearance',
  'overloading', 'sacrifice', 'quietMove',
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'backRankMate', 'smotheredMate', 'arabianMate', 'hookMate', 'anastasiasMate', 'epauletteMate',
  'endgame', 'pawnEndgame', 'rookEndgame', 'queenEndgame', 'bishopEndgame', 'knightEndgame',
  'advancedPawn', 'attackingF2F7', 'capturingDefender', 'exposedKing',
  'kingsideAttack', 'queensideAttack', 'crushing', 'defensiveMove',
  'enPassant', 'promotion', 'zugzwang', 'xRayAttack', 'coercion',
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function shuffle<T>(arr: T[]): T[] {
  return pickRandom(arr, arr.length);
}

class BatchFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function statusToMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'Lichess rejected the API token (401/403). Check LICHESS_API_TOKEN in .env.local.';
  }
  if (status === 429) {
    return 'Lichess rate limit reached (429). Wait a minute and try again.';
  }
  if (status >= 500) {
    return `Lichess server error (${status}). Try again in a few seconds.`;
  }
  return `Lichess batch fetch failed (${status}).`;
}

interface LichessBatchPuzzle {
  puzzle: { id: string; initialPly?: number; solution?: string[]; themes?: string[]; rating?: number };
  game: { pgn?: string };
}

async function fetchSingleBatch(theme: string, difficulty: Difficulty, nb: number, token: string): Promise<LichessBatchPuzzle[]> {
  const url = `https://lichess.org/api/puzzle/batch/${theme}?nb=${nb}&difficulty=${difficulty}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    console.error(`[lichess/batch] fetch("${url}") failed:`, err);
    throw new BatchFetchError('Could not reach Lichess. Check your internet connection or try again.', 0);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[lichess/batch] ${url} -> ${res.status}: ${body.slice(0, 300)}`);
    throw new BatchFetchError(statusToMessage(res.status), res.status);
  }
  const data = await res.json();
  return data.puzzles ?? [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const themesRaw = searchParams.get('themes') ?? searchParams.get('theme');
  const difficultyRaw = searchParams.get('difficulty') || 'normal';
  const nb = Math.min(50, Math.max(1, parseInt(searchParams.get('nb') || '10', 10)));

  if (!themesRaw) {
    return NextResponse.json({ error: 'themes is required' }, { status: 400 });
  }

  const token = process.env.LICHESS_API_TOKEN;
  if (!token) {
    console.error('[lichess/batch] LICHESS_API_TOKEN is not set in this deployment\'s environment');
    return NextResponse.json({ error: 'LICHESS_API_TOKEN not configured on the server' }, { status: 500 });
  }

  const themes: string[] = themesRaw === 'mixed'
    ? pickRandom(ALL_THEMES, 4)
    : themesRaw.split(',').map(t => t.trim()).filter(Boolean);

  if (themes.length === 0) {
    return NextResponse.json({ error: 'At least one theme is required' }, { status: 400 });
  }

  const difficulties: Difficulty[] = difficultyRaw === 'mixed'
    ? ['easier', 'normal', 'harder']
    : VALID_DIFFICULTIES.includes(difficultyRaw as Difficulty)
      ? [difficultyRaw as Difficulty]
      : ['normal'];

  const pairs: Array<{ theme: string; difficulty: Difficulty }> = [];
  for (const theme of themes) for (const difficulty of difficulties) pairs.push({ theme, difficulty });
  const nbPerCall = Math.ceil(nb / pairs.length);

  try {
    const results = await Promise.allSettled(
      pairs.map(({ theme, difficulty }) => fetchSingleBatch(theme, difficulty, nbPerCall, token))
    );

    const seen = new Set<string>();
    const allPuzzles: Array<{
      lichessId: string; fen: string; pgn: string; solution: string[]; themes: string[];
      rating: number | null; orientation: 'white' | 'black';
    }> = [];
    let firstError: BatchFetchError | null = null;

    for (const result of results) {
      if (result.status === 'rejected') {
        if (!firstError && result.reason instanceof BatchFetchError) firstError = result.reason;
        continue;
      }
      for (const item of result.value) {
        const id = item.puzzle?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const pgn = item.game?.pgn ?? '';
        const initialPly = item.puzzle?.initialPly ?? 0;
        const fen = fenAtPly(pgn, initialPly);
        const turn = fen.split(' ')[1];
        const uciMoves = item.puzzle?.solution ?? [];

        allPuzzles.push({
          lichessId: id,
          fen,
          pgn,
          solution: uciSolutionToSan(fen, uciMoves),
          themes: item.puzzle.themes ?? [],
          rating: item.puzzle.rating ?? null,
          orientation: turn === 'b' ? 'black' : 'white',
        });
      }
    }

    if (allPuzzles.length === 0 && firstError) {
      return NextResponse.json({ error: firstError.message }, { status: firstError.status || 502 });
    }

    const puzzles = shuffle(allPuzzles).slice(0, nb);
    console.log(`[lichess/batch] returning ${puzzles.length} puzzles for themes=${themes.join(',')}`);
    return NextResponse.json({ puzzles });
  } catch (err) {
    console.error('[lichess/batch] unhandled error:', err);
    return NextResponse.json({ error: 'Failed to fetch batch puzzles' }, { status: 500 });
  }
}
