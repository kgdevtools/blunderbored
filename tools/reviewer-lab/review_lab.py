#!/usr/bin/env python3
"""Reference implementation of blunderbored's game-review pipeline on native
Stockfish, for testing / modelling / optimising the classifier heuristics.

Mirrors lib/analysis.ts + lib/accuracy.ts EXACTLY (Lichess win% sigmoid,
accuracy curve, 10/20/30 verdict thresholds, phase classifier, opening-book
heuristic, missed-mate gate, cpLoss cap 1000, mate clamp ±10000) so its output
is directly diffable against the app's `window.__review` JSON.

Usage:
  ./.venv/bin/python review_lab.py game.pgn                 # first game, table out
  ./.venv/bin/python review_lab.py games.pgn --game 2 -v    # verbose engine info
  ./.venv/bin/python review_lab.py game.pgn --depth 22 --json lab.json
Then diff against the app:  in the browser console after a review, run
  copy(JSON.stringify(window.__review))   → paste into app.json
  ./.venv/bin/python compare_reviews.py app.json lab.json
"""
import argparse, json, math, os, sys, time
import chess, chess.engine, chess.pgn

# ── Math layer (must match lib/accuracy.ts) ──────────────────────────────────
def win_p(cp: float) -> float:
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)

def move_accuracy(wp_before: float, wp_after: float) -> float:
    return max(0, min(100, 103.1668 * math.exp(-0.04354 * (wp_before - wp_after)) - 3.1669))

def classify(wpl: float) -> str:
    # Recalibrated 2026-07-14: lichess judgments are 0.1/0.2/0.3 on its −1..+1
    # winning-chances scale = 5/10/15 points here (old 10/20/30 was a 2× error).
    # NOTE: the app's pipeline is now two-pass with 11 tiers (lib/analysis.ts +
    # lib/classification.ts); this lab mirrors only the base-tier math.
    if wpl < 5: return 'good'
    if wpl < 10: return 'inaccuracy'
    if wpl < 15: return 'mistake'
    return 'blunder'

def phase_of(board: chess.Board) -> str:
    count = len(board.piece_map())
    return 'opening' if count >= 20 else 'endgame' if count <= 12 else 'middlegame'

MATE_CP = 10000
CP_LOSS_CAP = 1000

def score_cp(pov_score: chess.engine.PovScore) -> int:
    """White-POV cp with the app's mate clamp."""
    s = pov_score.white()
    if s.is_mate():
        return MATE_CP if s.mate() > 0 else -MATE_CP
    return s.score()

# ── Review pipeline (must match analyseGame in lib/analysis.ts) ──────────────
def review_game(game: chess.pgn.Game, engine, depth: int, verbose: bool):
    board = game.board()
    positions = [board.copy()]
    sans = []
    for mv in game.mainline_moves():
        sans.append(board.san(mv))
        board.push(mv)
        positions.append(board.copy())

    evals, mates, bests, infos = [], [], [], []
    t0 = time.time()
    for i, pos in enumerate(positions):
        # Terminal positions: synthesize the eval — engines report "mate 0"
        # relative to the MATED side there, which sign-flips naively converted
        # scores and turns the mating move into a phantom blunder.
        if pos.is_game_over():
            if pos.is_checkmate():
                evals.append(MATE_CP if pos.turn == chess.BLACK else -MATE_CP)
                mates.append(0)
            else:  # stalemate / insufficient material / 75-move / repetition
                evals.append(0)
                mates.append(None)
            bests.append(None)
            infos.append({})
            continue
        info = engine.analyse(pos, chess.engine.Limit(depth=depth))
        evals.append(score_cp(info['score']))
        rel = info['score'].relative
        mates.append(rel.mate() if rel.is_mate() else None)
        bests.append(info.get('pv', [None])[0])
        infos.append(info)
        if verbose:
            print(f"  pos {i:3d}  d{info.get('depth','?')}  "
                  f"{info.get('nodes',0):>10,} nodes  {evals[i]:>6}cp  "
                  f"{(info.get('nps') or 0)/1e6:.1f} Mnps", file=sys.stderr)
    print(f"engine: {len(positions)} positions at depth {depth} "
          f"in {time.time()-t0:.1f}s", file=sys.stderr)

    moves = []
    for i, san in enumerate(sans):
        pos, nxt = positions[i], positions[i + 1]
        color = 'w' if pos.turn == chess.WHITE else 'b'
        eb, ea = evals[i], evals[i + 1]
        wp_b = win_p(eb if color == 'w' else -eb)
        wp_a = win_p(ea if color == 'w' else -ea)
        wpl = max(0, wp_b - wp_a)
        cp_loss = min(CP_LOSS_CAP, max(0, (eb - ea) if color == 'w' else (ea - eb)))
        played = pos.parse_san(san)
        best_mv = bests[i]
        game_over = nxt.is_game_over()
        phase = phase_of(pos)
        is_book = phase == 'opening' and i < 16 and wpl < 5 and not game_over
        quality = 'book' if is_book else classify(wpl)
        best = (not is_book) and best_mv is not None and best_mv == played
        had_mate = mates[i] is not None and 0 < mates[i] <= 10
        kept = mates[i + 1] is not None and mates[i + 1] < 0
        moves.append({
            'moveIndex': i, 'moveSan': san, 'color': color, 'phase': phase,
            'evalBefore': eb, 'evalAfter': ea,
            'winPctLoss': round(wpl, 2), 'cpLoss': cp_loss,
            'moveAccuracy': round(move_accuracy(wp_b, wp_a), 2),
            'quality': quality, 'best': best,
            'missedMate': had_mate and not kept and not best,
            'bestMoveSan': pos.san(best_mv) if best_mv and best_mv != played else '',
        })
    return moves

def summary(moves, side):
    mine = [m for m in moves if m['color'] == side]
    nb = [m for m in mine if m['quality'] != 'book']
    acc = sum(m['moveAccuracy'] for m in nb) / len(nb) if nb else 100.0
    acpl = sum(m['cpLoss'] for m in nb) / len(nb) if nb else 0
    counts = {q: sum(1 for m in mine if m['quality'] == q)
              for q in ('book', 'good', 'inaccuracy', 'mistake', 'blunder')}
    return acc, acpl, counts

# ── Output ────────────────────────────────────────────────────────────────────
TINT = {'book': '\033[90m', 'good': '\033[36m', 'inaccuracy': '\033[33m',
        'mistake': '\033[38;5;208m', 'blunder': '\033[31m'}
R = '\033[0m'

def print_table(moves):
    print(f"\n{'#':>3} {'mv':>4}  {'san':<10} {'ph':<3} {'evalB':>7} {'evalA':>7} "
          f"{'wpl':>6} {'cpL':>5} {'acc':>6}  verdict     best")
    print('─' * 78)
    for m in moves:
        n = m['moveIndex'] // 2 + 1
        mv = f"{n}{'.' if m['color'] == 'w' else '…'}"
        flags = ('★' if m['best'] else '') + ('M!' if m['missedMate'] else '')
        print(f"{m['moveIndex']:>3} {mv:>4}  {m['moveSan']:<10} {m['phase'][:2]:<3} "
              f"{m['evalBefore']:>7} {m['evalAfter']:>7} {m['winPctLoss']:>6.1f} "
              f"{m['cpLoss']:>5} {m['moveAccuracy']:>6.1f}  "
              f"{TINT[m['quality']]}{m['quality']:<10}{R} "
              f"{m['bestMoveSan']:<8} {flags}")

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('pgn'); ap.add_argument('--depth', type=int, default=18)
    ap.add_argument('--game', type=int, default=1, help='1-based game index in file')
    ap.add_argument('--engine', default=None)
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('--hash', type=int, default=256)
    ap.add_argument('--json', help='write app-diffable review JSON here')
    ap.add_argument('-v', '--verbose', action='store_true')
    a = ap.parse_args()

    eng_path = a.engine or os.path.join(os.path.dirname(__file__), 'bin', 'stockfish')
    engine = chess.engine.SimpleEngine.popen_uci(eng_path)
    engine.configure({'Threads': a.threads, 'Hash': a.hash})

    with open(a.pgn) as f:
        game = None
        for _ in range(a.game):
            game = chess.pgn.read_game(f)
        if game is None:
            sys.exit(f'game #{a.game} not found in {a.pgn}')

    h = game.headers
    print(f"{h.get('White','?')} vs {h.get('Black','?')} · {h.get('Result','*')} "
          f"· {h.get('Event','')}", file=sys.stderr)
    moves = review_game(game, engine, a.depth, a.verbose)
    engine.quit()

    print_table(moves)
    print('\nside   accuracy   ACPL   book good inacc mist blun')
    for side, name in (('w', 'White'), ('b', 'Black')):
        acc, acpl, c = summary(moves, side)
        print(f"{name:<6} {acc:>7.1f}%  {acpl:>5.0f}   {c['book']:>4} {c['good']:>4} "
              f"{c['inaccuracy']:>5} {c['mistake']:>4} {c['blunder']:>4}")

    if a.json:
        with open(a.json, 'w') as f:
            json.dump({'moves': moves, 'depth': a.depth}, f, indent=1)
        print(f"\n→ {a.json}")

if __name__ == '__main__':
    main()
