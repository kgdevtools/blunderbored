// Shared helpers for the Lichess puzzle-import API routes. Lichess's puzzle
// endpoints return a game PGN + an initialPly, not a FEN directly — the
// position has to be replayed out, same for both the single and batch routes.

import { Chess } from 'chess.js';

export function fenAtPly(pgn: string, initialPly: number): string {
  const game = new Chess();
  const moves = pgn
    .trim()
    .split(/\s+/)
    .filter(t =>
      !/^\d+\.+$/.test(t) &&
      !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t) &&
      !/^[!?]+$/.test(t)
    );
  for (let i = 0; i <= Math.min(initialPly, moves.length - 1); i++) {
    try {
      const result = game.move(moves[i]);
      if (!result) break;
    } catch {
      break;
    }
  }
  return game.fen();
}

export function uciSolutionToSan(fen: string, uciMoves: string[]): string[] {
  const game = new Chess(fen);
  return uciMoves.map(uci => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci[4] ?? null;
    try {
      const legal = game.moves({ verbose: true });
      const match = legal.find(m => m.from === from && m.to === to && (!promo || m.promotion === promo));
      if (!match) return uci;
      game.move(match.san);
      return match.san;
    } catch {
      return uci;
    }
  });
}
