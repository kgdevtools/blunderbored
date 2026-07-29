// Single-puzzle fetch for the "Single URL" import tab. Public Lichess data,
// so the token is sent when available (higher rate limit) but not required.

import { NextResponse } from 'next/server';
import { fenAtPly, uciSolutionToSan } from '@/lib/lichessPuzzle';

export async function GET(_request: Request, { params }: { params: Promise<{ puzzleId: string }> }) {
  try {
    const { puzzleId } = await params;
    const token = process.env.LICHESS_API_TOKEN;
    console.log(`[lichess/${puzzleId}] fetching (token present: ${!!token})`);

    const res = await fetch(`https://lichess.org/api/puzzle/${puzzleId}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[lichess/${puzzleId}] Lichess responded ${res.status}: ${body.slice(0, 300)}`);
      return NextResponse.json({ error: `Lichess returned ${res.status} for puzzle "${puzzleId}"` }, { status: res.status });
    }

    const data = await res.json();
    const pgn: string = data.game?.pgn ?? '';
    const initialPly: number = data.puzzle?.initialPly ?? 0;
    const fen = fenAtPly(pgn, initialPly);
    const uciMoves: string[] = data.puzzle?.solution ?? [];

    return NextResponse.json({
      lichessId: data.puzzle?.id ?? puzzleId,
      fen,
      pgn,
      solution: uciSolutionToSan(fen, uciMoves),
      themes: data.puzzle?.themes ?? [],
      rating: data.puzzle?.rating ?? null,
      orientation: fen.split(' ')[1] === 'b' ? 'black' : 'white',
    });
  } catch (err) {
    console.error('[lichess/[puzzleId]] unhandled error:', err);
    return NextResponse.json({ error: 'Failed to fetch puzzle' }, { status: 500 });
  }
}
