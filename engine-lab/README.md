# engine-lab — is the engine weak, or are we?

Terminal harness that drives the **exact** binary the app ships
(`public/engine/stockfish-18-lite-single.js`, single-threaded WASM "Lite") over
UCI, so we can measure strength instead of guessing.

## Run it

```bash
node engine-lab/run-nps.mjs 1500          # raw speed (nodes/sec, reachable depth)
node engine-lab/run-strength.mjs --ref 2000          # cpl-vs-optimal for the app's configs
node engine-lab/run-strength.mjs --skill --depth     # also compare Skill Level & depth-limiting
node engine-lab/probe.mjs "<fen>" --elo 2250 --movetime 1500   # one position, one config
```

`run-strength` is **self-calibrating**: a full-strength "referee" (Hash 64, long
time) defines optimal eval, then each config plays and the referee scores how
much eval it threw away → **centipawn loss (cpl)**, mover's POV. Lower = stronger.

## Verdict — the flaw is OUR strength model, not the binary

Measured on this machine (7 positions; small N, so read medians + trends):

| config (app today) | avg cpl | median | matchBest | note |
|---|---|---|---|---|
| `full@800` (full strength, 800ms) | ~12–16 | ~4 | 4/7 | **near-optimal** |
| `full@2600` | ~17 | ~5 | 4/7 | strong |
| `elo1350 … elo2600` (UCI_LimitStrength) | 11–63 | 1–58 | 1/7 | **erratic** |
| `elo2250` across runs | 36 / 52 | 1 / 14 | — | same Elo, wild variance |
| `depth6 / 8 / 10 / 12` (depth-limited) | 38 / 20 / 17 / 19 | ~5 | — | **smooth, predictable** |
| `skill5/10/15/20` | 16 / 54 / 20 / 14 | — | — | also noisy, non-monotonic |

Raw speed: **~350–440k nps**, reaching depth ~18–22 in 1.5s.

### What this means

1. **The engine is NOT weak.** At full strength it plays ~12 cpl from optimal at
   just 800 ms / 400k nps. The WASM Lite build and the tiny `Hash 4` are not the
   bottleneck at our time controls.
2. **`UCI_LimitStrength` is the problem.** It hits a target Elo by *randomly
   sampling weaker moves*, so the same setting swings from clean to 60-cpl
   clunkers run-to-run. That stochastic handicap is exactly the "feels weak and
   inconsistent" complaint — and it's unrelated to think-time.
3. **Scaling movetime under the limit is mostly wasted.** `elo2250@500` vs
   `@4000` is dominated by sampling noise, not depth. Our recent "scale movetime
   with rating" change buys little while the limiter is on.
4. **Depth/node limiting weakens *gracefully*** — full-strength move choice with a
   shallow search. cpl rises smoothly as depth drops and never injects a random
   blunder into a calm position. This is the predictable knob we want.

### Shipped model (replaced UCI_LimitStrength)

`node engine-lab/calibrate-nodes.mjs` then showed a twist: node-limiting **alone**
keeps it strong — even 1000 nodes is ~13–30 cpl, because the NNUE eval finds good
moves at shallow depth. So pure depth/node reduction can't make a believable 1350.

Final model = **node cap (consistency) + top-K softmax sampling (rating texture)**:
- `go nodes N`, full strength, `MultiPV 4`.
- Sample among the top 4 lines via softmax weighted by score, temperature in cp.
- `ratingToNodes`: 50k → 1M (geometric). `ratingToTempCp`: 140 → 6.

Validated (`run-model.mjs`, node cap + top-4 softmax, cpl-vs-optimal):

| rating | nodes | tempCp | avg cpl | worst sample |
|---|---|---|---|---|
| 1350 | 50k | 140 | ~39 | ~186 |
| 1900 | 187k | 81 | ~28 | ~115 |
| 2250 | 432k | 44 | ~32 | — |
| 2600 | 1.0M | 6 | **~10** | ~44 |

vs the old `elo2250` at **36–63 cpl with wild run-to-run variance**. The new top end
is strong *and* consistent; low ratings play plausible human inaccuracies (bounded
to the top 4 — no random blunder dropped into a calm position). Scoring stays full
strength so blunder detection is unaffected.

Re-run `node engine-lab/run-model.mjs` after changing the curves in
`lib/strengthModel.ts` to re-validate (the model moved out of
BlunderableShell.tsx in v2; run-model.mjs mirrors it).

### v2 model (2026-07-02): + candidate window, decided-position tightening, pv2 at top

Changes: lines outside a rating-scaled window of the best (250cp @1350 → 40cp
@2600) are excluded before softmax (kills "garbage-line" picks at low node
budgets); temperature halves when |best| > 500cp; MultiPV drops to 2 above 2400.

Validated (7 positions × 6 samples):

| rating | nodes | tempCp | winCp | pv | avg cpl | worst sample |
|---|---|---|---|---|---|---|
| 1350 | 50k | 140 | 250 | 4 | ~38 | ~137 (was ~186) |
| 1600 | 91k | 113 | 208 | 4 | ~37 | ~176 |
| 1900 | 187k | 81 | 158 | 4 | ~32 | ~137 |
| 2250 | 432k | 44 | 99 | 4 | ~35 | ~137 |
| 2600 | 1.0M | 6 | 40 | 2 | ~18 | ~118 (rare: weight of line 2 at temp 6 ≈ e^(−40/6)) |

Averages hold the v1 curve; the tail (worst single sample) tightens across the
board. Residual worst-case spread is sub-vs-referee eval disagreement, not
sampling: the window is enforced against the *node-capped* eval, the referee
scores with a much deeper one.

---

## Appendix — every knob the app turns (so you can audit our side)

### Engine I/O (`lib/engine.ts`)
- `setoption Hash value 4` — 4 MB transposition table (very small; harmless at our movetimes, measured).
- `setoption MultiPV value <n>` — 1 for play & scoring.
- `setStrength(elo)`: `UCI_LimitStrength true/false` + `UCI_Elo` clamped **1320–3190**. ← the suspect.
- play: `go movetime <ms>`; scoring: `go depth <d>`.
- Timeouts: handshake **12 s**, search **25 s**. No `ucinewgame` between positions.

### Strength / performance (`components/blunderable/BlunderableShell.tsx`)
- `ENGINE_DEPTH = 12` (full-strength scoring search depth).
- `engineMovetime(elo) = 500 + t·3000 ms`, `t=(elo−1350)/1250` → 500 ms … 3500 ms.
- `EVAL_TIMEOUT_MS = 12 000` (client cap on a scoring eval).
- Rating slider **1350–2600**; clocks **3/5/10 min**, increment **0/2/5 s**; survive target **3–10**.
- Pondering: speculative `bestMove(predictedLine)`; reused only if finished, else cancelled before scoring.

### Move classifier — win%-based (`lib/blunder.ts`, `lib/accuracy.ts`)
- Win% sigmoid: `winP(cp) = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)` (Lichess).
- Self-loss per move = `winP(before) − winP(afterYourMove)` (player POV, **pre** engine reply).
- Bands: inaccuracy **≥5%**, mistake **≥10%**, blunder **≥15%** (`SELF_INACC/MISTAKE/BLUNDER_WP`).
- A single **blunder ends the run**; cumulative self-loss **≥20%** (`CUMULATIVE_FAIL_WP`) ends it by "drift".
- Accuracy: `moveAccuracy(Δwp) = 103.1668·e^(−0.04354·Δ) − 3.1669` (Lichess), averaged.
- Verdict headline: net win% surrendered start→end, banded 3 / 10 / 20%.

### Time classifier (`timeBands` / `classifyMoveTime`)
- Scaled from a 180 s baseline (15/20/30/45 s): `noted=base/12, key=base/9, struggling=base/6, study=base/4`.
