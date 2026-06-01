# Game Reviewer — Feature Plan

**Route:** `app/analysis/page.tsx`  
**Status:** ✅ Complete — all 4 phases shipped.

---

## Feature Summary

A full game review pipeline: user pastes a PGN, the engine evaluates every position, and the result is a Lichess-style annotated game with per-move quality labels, best-move suggestions, accuracy scores for both sides, and K-MAPS positional commentary — all navigable on an interactive board.

---

## What Changed vs Original Implementation

| Area | Before | After (Phase 1 ✅) |
|---|---|---|
| Move quality | Binary `isMistake` (200cp flat) | 6-tier Lichess system via win% loss |
| Engine call | `evaluate()` depth 18 (crashes WASM) | `evaluateMulti(fen, 14, 1)` — score + best move in one call |
| Best move | Not stored | UCI → SAN, stored in `ReviewedMove.bestMoveSan` |
| Accuracy | Not calculated | Lichess win-probability formula, per move + game total |
| Opening moves | Marked as mistake if > 200cp | "Book" via Polyglot lookup + heuristic fallback |
| K-MAPS | Partial stubs (activity, space only) | Full: King Safety, Activity, Pawn Structure, Space |
| Data model | Flat `AnalysedPosition[]` | Structured `ReviewedMove[]` with quality, K-MAPS object |
| UI layout | Static board + 2-column table | Board page layout: eval bar + board + right panel *(Phase 3)* |
| Navigation | Separate `useAnalyser` with index | `useGameReviewer` hook with FEN + move index *(Phase 2)* |

---

## Data Model

```typescript
// lib/accuracy.ts (new file)
export type MoveQuality = 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const QUALITY_META: Record<MoveQuality, { symbol: string; label: string; color: string }> = {
  book:        { symbol: '≡',  label: 'Book',        color: 'text-zinc-500'   },
  best:        { symbol: '✓',  label: 'Best',        color: 'text-blue-400'   },
  excellent:   { symbol: '!',  label: 'Excellent',   color: 'text-green-400'  },
  good:        { symbol: '+',  label: 'Good',        color: 'text-teal-400'   },
  inaccuracy:  { symbol: '?!', label: 'Inaccuracy',  color: 'text-yellow-400' },
  mistake:     { symbol: '?',  label: 'Mistake',     color: 'text-orange-400' },
  blunder:     { symbol: '??', label: 'Blunder',     color: 'text-red-500'    },
};

// lib/analysis.ts (rewrite)
export interface ReviewedMove {
  // Identity
  moveIndex: number;       // 0-based
  moveSan: string;
  color: 'w' | 'b';
  phase: GamePhase;

  // Positions
  fenBefore: string;       // position before this move
  fenAfter: string;        // position after this move

  // Raw engine scores (White's perspective, centipawns)
  evalBefore: number;
  evalAfter: number;

  // Best move
  bestMoveSan: string;     // SAN; empty string if played move = best
  bestMoveUci: string;     // UCI

  // Classification
  quality: MoveQuality;
  cpLoss: number;          // from side-to-move's perspective, always >= 0
  winPctLoss: number;      // 0–100; drives quality label

  // Accuracy contribution (Lichess formula)
  moveAccuracy: number;    // 0–100 for this move
  isBook: boolean;         // true if opening phase + cpLoss < 5cp (excluded from accuracy avg)

  // K-MAPS
  kmaps: KmapsResult;
}

export interface KmapsResult {
  kingSafety: string | null;    // e.g. "King exposed on open h-file"
  activity:   string | null;    // e.g. "White has 5 more legal moves"
  pawnStructure: string | null; // e.g. "Isolated d-pawn"
  space:      string | null;    // e.g. "White controls more territory"
}

export interface GameReview {
  moves: ReviewedMove[];
  whiteSummary: SideSummary;
  blackSummary: SideSummary;
}

export interface SideSummary {
  accuracy: number;      // 0–100, average of non-book move accuracies
  counts: Record<MoveQuality, number>;
}
```

---

## Accuracy Formula (Lichess)

### Win Probability
Converts centipawns to a 0–100 win percentage:
```
winP(cp) = 50 + 50 × (2 / (1 + exp(−0.00368208 × cp)) − 1)
```
This is the standard Elo-based sigmoid. At cp = 0, winP = 50%. At cp = +500, winP ≈ 83%.

### Per-Move Accuracy
```
accuracy(wpBefore, wpAfter) = clamp(0, 100,
  103.1668 × exp(−0.04354 × (wpBefore − wpAfter)) − 3.1669
)
```
Where `wpBefore` and `wpAfter` are from the **moving side's** perspective (negate for Black).

A perfect move (wpBefore ≈ wpAfter) scores ~100. A blunder (wpAfter << wpBefore) approaches 0.

### Game Accuracy
Average of all non-book move accuracies for each side. Book moves are excluded.

---

## Move Quality Classification

Thresholds are based on **win% loss** from the moving side's perspective:

| Quality | Win% Loss | Symbol |
|---|---|---|
| Book | — (opening + < 5cp loss) | ≡ |
| Best | < 2% | ✓ |
| Excellent | 2–5% | ! |
| Good | 5–10% | + |
| Inaccuracy | 10–20% | ?! |
| Mistake | 20–40% | ? |
| Blunder | ≥ 40% | ?? |

Using win% instead of raw centipawns means a 100cp swing at ±5.00 (effectively won/lost position) is correctly labelled as minor, while the same swing near 0.00 is correctly labelled as a blunder.

---

## Opening "Book" Detection

### Polyglot Book — `gm2600.bin`

**Recommended book:** `gm2600.bin` — built from games by GMs rated 2600+. Provides thorough coverage of all major opening systems at a manageable file size (~2 MB).

**Placement:** `public/books/gm2600.bin`  
*(Download from a Polyglot book repository, e.g. Zipproth/Polyglot book collection or similar. Not bundled in source control due to binary size.)*

**Format (Polyglot .bin):**
- Fixed-size 16-byte entries, sorted ascending by 64-bit Zobrist key
- Per entry: `key[8B uint64 BE] | move[2B uint16 BE] | weight[2B uint16 BE] | learn[4B uint32 BE]`
- Move field: bits 0–5 = to-square, bits 6–11 = from-square, bits 12–14 = promotion (0=none,1=N,2=B,3=R,4=Q)
- Castling: king moves to rook's square (e1h1, e1a1, e8h8, e8a8) — must translate to UCI (e1g1, e1c1, e8g8, e8c8)

**Zobrist key computation (`lib/polyglot.ts`):**
Uses 781 Random64 values (the standard Polyglot table):
- `Random64[piece_index * 64 + sq]` per piece (piece_index = (type−1)×2 + (color=black?1:0))
- `Random64[768–771]` for castling rights (WK, WQ, BK, BQ)
- `Random64[772 + file]` for en passant — **only if a pawn can actually capture**
- `Random64[780]` XORed when Black to move

**Verification:** Starting position key = `0x463B96181691FC9C`

**Lookup strategy:**
1. Load `gm2600.bin` once via `fetch('/books/gm2600.bin')` (cached as `ArrayBuffer`)
2. Compute Polyglot key for `fenBefore`
3. Binary search the sorted file for matching key
4. Collect all moves at that key (multiple book moves per position)
5. `isBook = bookMoves.includes(playedMoveUci)`

**Fallback heuristic (when book file unavailable or position not in book):**
- `classifyPhase(fen) === 'opening'` AND `cpLoss < 5cp`
- Catches very-accurate opening moves outside the book's coverage

Moves satisfying either condition get `quality = 'book'` and are excluded from accuracy averaging.

---

## K-MAPS Implementation Plan

Each component returns a `string | null` note (most impactful finding, or null if position is normal).

### King Safety
```
- Locate king square
- Count pawn shield (pawns on f/g/h for kingside-castled, b/c/d for queenside)
- Check for open/semi-open files toward the king (no pawn cover)
- Estimate attacker proximity (pieces within 2 ranks of king)
- Output: "King exposed on open [file]-file", "Pawn shield intact", null
```

### Activity / Mobility
```
- Count legal moves for each side at this position
- Flag any piece with 0 legal moves as potentially trapped
- Compare mobility: if diff > 5, report advantage
- Output: "[Side] has significant mobility advantage (N vs M moves)", null
```

### Pawn Structure
```
- Scan all pawns per file
- Doubled: multiple friendly pawns on same file
- Isolated: no friendly pawn on adjacent files
- Passed: no opposing pawn on same or adjacent files ahead
- Backward: no support behind and can't safely advance
- Report the most critical weakness/strength
- Output: "Isolated [file]-pawn", "Passed [file]-pawn", null
```

### Space
```
- Count friendly pieces and pawns in opponent's half (ranks 5-8 for White, 1-4 for Black)
- Count opponent's pieces in their own half
- Output: "[Side] controls more space", null
```

---

## Analysis Pipeline

The engine is called once per position (not once per move):

```
positions: [start, after_m1, after_m2, ..., after_mN]   ← N+1 total FENs

For each position[i]:
  result[i] = evaluateMulti(fen[i], depth=14, pvCount=1)
             → { score, bestMoveUci, bestMoveSan, depth }

For each move[i] (1..N):
  evalBefore = result[i-1].score
  evalAfter  = result[i].score
  bestMove   = result[i-1].bestMoveUci (best at position before the move)
  cpLoss     = evalBefore − evalAfter  (White); evalAfter − evalBefore  (Black)
  wpBefore   = winP(evalBefore, color)
  wpAfter    = winP(evalAfter, color)
  winPctLoss = wpBefore − wpAfter
  quality    = classify(winPctLoss, phase, cpLoss)
  accuracy   = lichessAccuracy(wpBefore, wpAfter)
  kmaps      = kmapsAnalyse(fen[i])
```

This is O(N+1) engine calls, all sequential (single Stockfish worker).

**Engine fix applied:** `analyseGame` uses `evaluateMulti(fen, 14, 1)`. The legacy `analyseGameWithEngine` is also updated to `evaluateMulti(fen, 14, 1)` and kept for backwards compatibility until Phase 4 replaces `AnalysisClient`.

---

## UI Design

Mirror the Board page layout:

```
┌────────────────────────────────────────────────────────────┐
│ [EvalBar]  [Board — navigable]   [Right panel              ]│
│                                  [  Game Summary           ]│
│                                  [  White: 78%  Black: 65% ]│
│                                  [  ──────────────────────  ]│
│                                  [  Move list               ]│
│                                  [  1. e4 ✓  e5 !          ]│
│                                  [  2. Nf3 +  Nc6 ??       ]│
│                                  [     ↳ [K-MAPS dropdown]  ]│
│                                  [  ──────────────────────  ]│
│                                  [  ◀◀  ◀  ▶  ▶▶  (+ 3-dot)]│
│  [PGN load + Export]                                        │
└────────────────────────────────────────────────────────────┘
```

### Move List Design
Each row:
```
1.  e4  ✓  +0.20            Nc6  ??  −1.40 → Nf3 (+0.35)
    [move]  [symbol] [eval]  [move]  [symbol] [eval] [best]
```

Clicking a move row (or its symbol) expands a K-MAPS dropdown inline:
```
    ┌─────────────────────────────────────────────────┐
    │ 👑 King safety  Pawn shield intact               │
    │ ⚡ Activity     White has 8 more legal moves      │
    │ ♟  Pawns        Isolated d5-pawn                 │
    │ 🗺  Space        White controls more territory    │
    └─────────────────────────────────────────────────┘
```
Only rows with a non-null value are shown.

### Game Summary Card
```
┌──────────────────────────────┐
│  White  78.3%   Black  65.1% │
│  ✓ 12   ! 4   + 3            │
│  ?! 2   ? 1  ?? 0            │
└──────────────────────────────┘
```

---

## File Structure

```
lib/
├── accuracy.ts         NEW — winP(), lichessAccuracy(), classifyQuality(), QUALITY_META
├── kmaps.ts            REWRITE — structured KmapsResult, all 4 components
└── analysis.ts         REWRITE — ReviewedMove, GameReview, analyseGame()

hooks/
└── useGameReviewer.ts  NEW — orchestrates analysis, returns GameReview + progress

components/game-reviewer/
├── ReviewerShell.tsx   NEW — outer layout (mirrors BoardShell)
├── GameSummary.tsx     NEW — accuracy % + tier counts
├── ReviewMoveList.tsx  NEW — annotated move list with quality + expandable K-MAPS
└── MoveKmapsPanel.tsx  NEW — expandable K-MAPS detail panel

app/analysis/
└── page.tsx            UPDATE — pass ?pgn= to ReviewerShell
```

---

## Implementation Phases

### Phase 1 — Analysis engine (data layer) ✅
- [x] `lib/accuracy.ts` — winP, moveAccuracy, winPctLossForSide, classifyQuality, QUALITY_META
- [x] `lib/polyglot.ts` — Random64 table, polyglotKey(), getBookMoves(), isBookMove(), ensureBookLoaded()
- [x] `lib/kmaps.ts` — KmapsResult struct, all 4 components (king safety, activity, pawn structure, space)
- [x] `lib/analysis.ts` — ReviewedMove, GameReview, SideSummary, analyseGame() using evaluateMulti(14,1)

### Phase 2 — Hook ✅
- [x] `hooks/useGameReviewer.ts` — wraps analyseGame, exposes GameReview + isLoading + progress + navigation (currentFen, currentMove, currentEval, goTo/Forward/Back/Start/End)

### Phase 3 — Components
- [ ] `ReviewerShell.tsx` — board page layout: reuses EvalBar, Chessboard, BoardControls
- [ ] `GameSummary.tsx` — accuracy % + tier count cards
- [ ] `ReviewMoveList.tsx` — annotated list with quality symbols, eval inline, best move
- [ ] `MoveKmapsPanel.tsx` — expandable K-MAPS detail

### Phase 4 — Integration
- [ ] Wire `app/analysis/page.tsx` to `ReviewerShell`
- [ ] Navigation: clicking a move in the list jumps the board to that position
- [ ] Board navigation (← →) also highlights the active move in the list

---

## Key Constraints & Gotchas

1. **Single Stockfish worker**: Analysis is sequential — N+1 evaluations in series. For a 40-move game at depth 14, expect ~30–60 seconds. Show clear per-move progress.
2. **evalBefore for move 1**: Need to evaluate the starting position FEN before any moves. Currently the loop starts from after move 1 — this must be fixed.
3. **Win% formula inputs**: Always pass centipawns from White's perspective into `winP()`, then flip sign for Black when computing `wpBefore`/`wpAfter`.
4. **Best move = played move**: If `bestMoveUci === playedMoveUci`, don't show the "best move" suggestion — it's already the best.
5. **K-MAPS at whose turn?**: Compute K-MAPS on `fenAfter` (position after the move). This reflects the *result* of the move on positional factors.
6. **Opening book skip**: The `isBook` flag must be set BEFORE computing accuracy averages — `SideSummary.accuracy` must filter them out.
7. **Mate score handling**: When the engine returns a mate score (e.g., M3), convert to ±10000cp before passing to `winP()` — don't pass the raw mate value directly.
