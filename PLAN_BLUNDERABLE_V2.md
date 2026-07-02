# Blunderable v2 — Reliability, Judging Model & UI Revamp (plan for review)

Status: **implemented 2026-07-02** (all four phases; unstaged, awaiting user
review). Deviations from spec noted inline with “IMPL:”.
IMPL: the playing screen's progress strip shows only `survived n/target` — the
planned `drift x/20wp` readout was dropped because it leaks live eval feedback,
contradicting the blind-play decision (§4/§7-3).
Supersedes the Feature-B section of `PLAN_BLUNDERABLE.md` (v1 shipped; this
revises it). Workflow: each phase is eslint + `tsc --noEmit` checked, then
STOPS for user review; nothing staged.

---

## 1. Diagnosis — what's actually wrong

### 1.1 The engine "hangs / stops replying" — root cause found

`lib/engine.ts` routes all searches through one worker with hand-rolled
promise slots and a single `skipNextBestmove` boolean. That flag is the bug:

- `cancel()` sends `stop` and sets `skipNextBestmove = true`. But if the
  cancelled search had **already posted its `bestmove`** (sitting in the
  message queue), the flag instead eats the **next** search's `bestmove`.
  That search's promise then never resolves → `isBusy` stays true forever →
  `waitIfBusy()` (a 10 ms poll with **no timeout**) queues every subsequent
  call behind it → the engine goes silent. Exactly the reported symptom.
- The ponder flow makes this race easy to hit: a speculative `searchNodes`
  is cancelled the instant you move (`cancelPonder()`), i.e. at the highest-
  traffic moment, right before the scoring eval is issued.
- Layered timeouts (`SEARCH_TIMEOUT_MS` inside the service + `EVAL_TIMEOUT_MS`
  in the shell) each send their own `stop` + flag, so two timeouts in flight
  can eat two future bestmoves.
- "It's too weak" and "it hangs" are partly the same bug: when a reply search
  dies, the shell's catch hands the turn back silently — the engine appears
  to just stop playing.

**Fix: rewrite the service around a serialized job queue with request IDs.**
This is the standard robust UCI pattern:

- One FIFO queue; exactly one job owns the worker at a time. A job =
  `{ id, kind: 'eval' | 'play', fen, limits, resolve, reject }`.
- Every `bestmove` is matched to the **current job id** — nothing is ever
  "skipped", so a stale reply can't be misattributed.
- Cancellation = send `stop`, then **await the bestmove ack** before starting
  the next job (the stop-barrier). No flags.
- `isready`/`readyok` sync after strength/option changes; `ucinewgame` at
  challenge start (currently never sent — stale TT/killers carry across runs).
- Watchdog: one place, in the service. If a job gets no engine output for N
  seconds → terminate worker, reject the job, **auto-respawn** the worker and
  surface a non-fatal "engine restarted" toast. The shell never adds its own
  timeout again.
- `[engine]` console telemetry: job start/finish with duration, nps, queue
  depth — so the next "it stopped" report is diagnosable from the console.

**✅ DECIDED — single worker.** The job queue removes the races that made
sharing painful; a second wasm instance's memory cost isn't justified on the
PWA's low-end targets. Revisit only if pondering still causes latency
complaints after Phase A.

### 1.2 Strength model — keep the node+softmax core, fix its rough edges

`engine-lab` already proved the binary is strong (~12 cpl at 800 ms) and that
`UCI_LimitStrength` was the erratic culprit; the shipped model (node cap +
top-4 softmax, README table) is the right shape. Remaining defects:

- **Garbage-line sampling.** At low node budgets, MultiPV lines 2–4 are barely
  searched; softmax can pick a genuinely losing move in a calm position —
  reads as "random blunder", i.e. *too weak*. Fix: filter candidates to lines
  within a rating-scaled window of the best (e.g. 250 cp at 1350 → 40 cp at
  2600) **before** softmax; never sample a line the referee would call a
  blunder when the best line is quiet.
- **Weak-move starvation at the top.** Above ~2400, temperature ≈ 6 cp makes
  MultiPV-4 pointless work; use MultiPV 1–2 there (faster replies).
- **No floor for reply quality in lost positions**: when the engine is
  completely winning/losing, sampling temperature should tighten (real
  players convert/resist harder). Small curve tweak.
- Re-validate the curves with the existing harness (`run-model.mjs`) after
  each change — the lab is the contract, not vibes.
- **Pace**: node-capped searches at high ratings can still return in <100 ms
  (feels botlike) or occasionally seconds. Add a minimum-think delay
  (~300–700 ms, rating-scaled) purely for feel, and cap wall time.

### 1.3 The report math — why "Your (est.) 2680" is nonsense

`estRating = 2800 − avgSelfLossWp × 70` — an invented linear map with no
grounding, computed over as few as 3–5 moves. Playing 5 quiet moves in an
already-lost position trivially yields 2680+. Compounding it:

- **Sample size**: no performance estimate is honest at n=5.
- **Contradictory headline**: "93% accuracy" next to "you made it worse".
  Both are technically computed correctly but from different frames: accuracy
  averages per-move self-loss; the position swing (−1.59 → −2.81) **includes
  the engine's replies**, which is not your doing alone — and at low ratings
  the engine's own sampled inaccuracies *improve* your eval, muddying it more.
- Depth-12 scoring evals carry ±30–50 cp jitter between positions, so
  small "self-losses" are partly noise. At ~400 knps, depth 14–16 costs well
  under a second — raise scoring depth (or use `go nodes` for determinism).

**Fix: report v2 (see §3) drops the fake Elo and decomposes the swing.**

---

## 2. The judging model, precisely defined

Player-POV win% (`winP`, Lichess sigmoid) throughout. Scoring always full
strength, fixed node budget for determinism.

| Term | Definition |
|---|---|
| `selfLoss(i)` | `winP(before move i) − winP(after move i, pre-reply)` — damage YOUR move did, isolated from the engine's reply. ≥ 0. |
| Move class | inaccuracy ≥ 5 wp · mistake ≥ 10 · blunder ≥ 15 (unchanged) |
| **Fail: blunder** | any single `selfLoss ≥ 15` (unchanged) |
| **Fail: drift** | cumulative `Σ selfLoss ≥ 20` (unchanged) |
| **Fail: regression** ★new | rolling window of the last 4 player moves: if win% declined on ≥ 3 of 4 **and** the window's total self-loss ≥ 12 wp → "gradually made it worse". Catches the slow bleed the user described that the single-move and cumulative gates miss. |
| **Missed win** ★new | position was winning (`winP ≥ 80`) and your move dropped it below 65 → flagged on the move and in the report (a distinct badge, not a new fail state — it usually already trips a class). |
| **Success** | reached the move target (or mate/stalemate/draw in your favour) without any fail trigger; engine flag = success (unchanged). |

All thresholds live in `lib/blunder.ts` as named constants with the rationale
in comments; the report and live play must read the SAME constants.

**✅ DECIDED — regression-fail is on by default.** It IS the product promise
("don't make the position gradually worse"). The setup screen states all
three fail conditions plainly; no strict-mode toggle.

---

## 3. Report v2 (the end-of-run modal)

Layout target: the screenshot's bones are right; fix the semantics and the
hierarchy.

1. **Verdict block** (top): Survived / Failed + reason sentence. Then the
   position story, decomposed honestly:
   - `Position: −1.59 → −2.81`
   - `Your moves cost −9 wp · engine gave back +4 wp` ← the decomposition
     (`Σ selfLoss` vs swing attributable to engine replies). No more
     "you made it worse" next to "93%" without explanation.
2. **Stat row**: Accuracy (harmonized: computed from the same selfLoss series,
   labelled "move accuracy") · Survived n/target · Opponent Elo. **The fake
   "Your (est.)" tile is removed.** In its place: a **quality line** shown
   only when n ≥ 8 non-book moves: "avg loss ≈ N cp/move — around <band>
   level vs this opponent", mapped from the engine-lab cpl↔rating table with
   an explicit ≈ and tooltip. Below 8 moves: no estimate at all.
3. **Key moments**: weakest move (kept) + any missed-win badge + up to 3
   "study this" squares (long-think moves ∩ eval-loss moves).
4. **Time chart** (kept, tightened) and the move list (kept).
5. Actions: Save position (kept) · **Save game to Library** ★new (writes the
   played PGN via the existing library save path, tagged folder pick) ·
   New challenge · Rematch same position ★new.

Typography: one scale, `text-[10px]` uppercase labels / `text-sm` values like
/board panels; kill the mixed font sizes and the orange-on-dark low-contrast
verdict text (use the class colors only on numbers).

---

## 4. Setup & playing screen UX

### Setup (keep the single screen, tighten it)
- **Source picker** as three explicit tabs instead of one magic textarea:
  `Position (FEN/editor) · PGN (paste) · Library` ★new — Library opens the
  existing LibraryModal in browse mode and pulls the chosen game's PGN in.
  The magic auto-detect textarea stays under the PGN tab.
- PGN flow: after load, the ply scrubber gets **"start here"** framing
  (current move shown big, side-to-move auto-selects your side with an
  override), not a bare slider.
- Target slider: extend to `3–20` + an "∞ / to the end" option (survive until
  the game resolves). Clock: keep presets, add a custom minutes field.
- The lab-validated rating slider copy: show expected style, e.g.
  "1600 · Club — occasional inaccuracies, rarely blunders".
- Kill the "Experimental" banner once v2 ships (it's uncommitted WIP today).

### Playing screen (match /board's compact, cosy density)
- Right panel becomes the /board-style stacked column: **both clocks**
  (opponent's ticking too — it exists in state, is never shown), a slim
  progress strip `survived 3/5 · drift 6/20wp`, the moves list filling the
  middle, controls pinned at the bottom.
- Status affordances: engine thinking = subtle pulse on ITS clock, not a
  floating "engine…" text; engine-restart toast from the watchdog.
- **✅ DECIDED — play stays fully blind.** No live eval, glyphs, or numbers
  during play; all feedback lands in the end report. It's the sport of it,
  and matches the locked design.
- Mobile: panel under board (already), ensure clock strip stays visible
  without scrolling during play; wake-lock (`navigator.wakeLock`) while the
  clock runs so the screen doesn't sleep mid-game (PWA nicety, cheap).

---

## 5. PWA / performance standards

- Engine worker: spawn on setup mount (kept), **terminate after N idle
  minutes** on the setup screen and on route leave (today it lives forever).
- `ucinewgame` + `isready` at challenge start; Hash stays small (4–16 MB,
  measured harmless); no threads (single-thread build is the contract).
- Scoring determinism: switch scoring from `go depth 12` to a fixed node
  budget (`go nodes ~600k` ≈ depth 15–17 here) — same cost, less jitter,
  device-independent verdicts.
- All engine traffic logged under `[engine]`, all challenge lifecycle under
  `[blunderable]` (already), with durations — consistent with the pgn-import
  logging pattern.
- Challenge history cap stays 50 (`MAX_HISTORY`) — these reports now feed the
  Insights "Training" section (see PLAN_INSIGHTS.md); keep shapes compatible:
  `ChallengeReport` gains optional `endReasonV2`/`windowFail` fields only,
  additive as always.

---

## 6. Phasing

| Phase | Scope | Risk gate |
|---|---|---|
| **A — Engine service rewrite** | Job queue, request IDs, stop-barrier, watchdog + auto-respawn, `ucinewgame`, telemetry. No behavior change to strength or scoring. | The hang class dies here. Verified via engine-lab probe + manual runs. |
| **B — Strength & scoring** | Candidate-window filter before softmax, MultiPV/temp curve tweaks, min-think pacing, node-based scoring. Re-run `run-model.mjs`, paste results into engine-lab/README. | Feels-right check by user at 1350 / 1900 / 2600. |
| **C — Judging + report v2** | Regression window, missed-win badge, swing decomposition, est-Elo removal, quality line, report layout, Save-to-Library + Rematch. | Screenshot review against §3. |
| **D — Setup & playing UI** | Source tabs + Library picker, ply "start here", target/clock options, both clocks, progress strip, wake lock, worker idle teardown, banner removal. | Screenshot review; mobile pass. |

Each phase: eslint + `tsc --noEmit`, then stop for review. No builds, no
staging (workflow rule).

---

## 7. Decisions — resolved 2026-07-02 ✅

1. **Engine worker**: single worker with the Phase-A job queue.
2. **Regression-fail**: on by default, no strict-mode toggle.
3. **Live move feedback**: none — play stays blind, feedback in the report.
4. **Rematch semantics**: exact same position + settings; engine sampling is
   naturally stochastic, no seed re-roll needed.
