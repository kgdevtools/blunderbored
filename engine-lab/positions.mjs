// Test positions. We deliberately DON'T hard-code "the right answer" — the
// harness computes ground truth itself by running the engine at full strength
// and deep, then measures how much each (weaker) config falls short. That keeps
// the test fair and self-calibrating.

export const POSITIONS = [
  { id: 'startpos',  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', note: 'opening' },
  // NOTE: the original example FEN (…/pQ1pn3/… w) is ILLEGAL — White to move but
  // Qb5 leaves Black's king in check. chess.js skipValidation hid that in the app;
  // Stockfish rejects it (bestmove (none)). Legal variant with the queen on b3:
  { id: 'user-fen',  fen: 'rq2k2r/1p3ppp/5n2/p2pn3/P7/1Q2PNP1/1P1N1PP1/R1R3K1 w - - 0 1', note: 'your example, legalised (White, +adv)' },
  { id: 'italian',   fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 4 5', note: 'quiet middlegame' },
  { id: 'sharp-Bg5', fen: 'r2q1rk1/1b1nbppp/p2ppn2/1p4B1/3NPP2/2N2Q2/PPP3PP/2KR1B1R w - - 0 1', note: 'sharp attack' },
  { id: 'tactic-1',  fen: 'r1b1kb1r/pp3ppp/2n1pn2/q7/2BP4/2N2N2/PP3PPP/R1BQ1RK1 w kq - 0 1', note: 'tactical' },
  { id: 'black-tac', fen: '2r3k1/pp2bppp/2n1p3/q7/3P4/P1N1PN2/1P2QPPP/R4RK1 b - - 0 1', note: 'Black to move' },
  { id: 'endgame',   fen: '8/5ppp/4k3/3p1b2/p6P/2B5/6P1/6K1 w - - 0 1', note: 'minor-piece endgame' },
];
