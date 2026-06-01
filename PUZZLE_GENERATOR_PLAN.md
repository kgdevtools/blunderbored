# Puzzle Generator — Feature Plan

**Route:** `app/puzzle-generator/page.tsx`  
**Status:** Planned

---

## Feature Summary

Takes a PGN (pasted directly or forwarded from the Game Reviewer / Board page) and extracts positions where the player made a mistake or blunder. A coach reviews each candidate position on an interactive board and saves the ones they like as training puzzles, tagging them with a difficulty level. Saved puzzles are stored locally and available in the `/learn-from-mistakes` and `/timed-puzzles` training routes.

---

## Entry Points

| Source | How |
|--------|-----|
| Direct | Paste PGN on `/puzzle-generator` page |
| Game Reviewer | "Send to Puzzle Generator" in 3-dot menu (forwards `GameReview` data — no re-analysis needed) |
| Board page | "Send to Puzzle Generator" in 3-dot menu (passes `?pgn=...` — triggers fresh analysis) |

---

## Data Model

```typescript
// lib/puzzleStore.ts
export interface Puzzle {
  id: string;                      // crypto.randomUUID()
  fen: string;                     // position BEFORE the mistake (the puzzle start)
  solution: string;                // UCI best move (engine answer)
  solutionSan: string;             // SAN of best move
  playerMove: string;              // UCI of what was actually played
  playerMoveSan: string;
  quality: 'mistake' | 'blunder';
  evalBefore: number;              // cp, White's POV
  evalAfter: number;
  cpLoss: number;
  kmaps: KmapsResult;
  difficulty: 'easy' | 'medium' | 'hard';
  theme?: string;                  // e.g. 'tactics', 'endgame', 'pawn-structure'
  notes?: string;                  // coach annotation
  createdAt: number;               // Date.now()
  sourcePgn?: string;              // original game
}
```

---

## Storage

**Phase 1:** `localStorage` under key `chess-academy:puzzles` (JSON array).  
**Phase 2 (future):** Supabase PostgreSQL — same schema, synced per user account.

```typescript
// lib/puzzleStore.ts exports
getPuzzles(): Puzzle[]
savePuzzle(p: Omit<Puzzle, 'id' | 'createdAt'>): Puzzle
deletePuzzle(id: string): void
clearPuzzles(): void
```

---

## Analysis Pipeline

When a PGN is pasted directly (no pre-analysed `GameReview`):
1. Run `analyseGame(pgn)` (same pipeline as Game Reviewer)
2. Filter `moves` where `quality === 'mistake' || quality === 'blunder'`
3. Present candidates one-by-one for review

When forwarded from Game Reviewer:
- Receive `GameReview` directly — skip re-analysis
- Filter on `quality` as above

---

## UI Design

```
┌──────────────────────────────────────────────────────────────┐
│  Puzzle Generator                                             │
│  ────────────────────────────────────────────────────────── │
│  [PGN textarea]  [Analyse]      or  [forwarded: Game vs ...]  │
│                                                              │
│  Found 5 mistakes / blunders   ●●●●○  3 / 5                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Move 22 — Black blunder ??   (swing: −4.20)          │   │
│  │                                                      │   │
│  │  [EvalBar]  [Board — position before mistake]        │   │
│  │                                                      │   │
│  │  Played: Qe7??   Best: Rxd4 (+0.35)                  │   │
│  │                                                      │   │
│  │  ♟  Pawn structure  Passed white pawn on d5           │   │
│  │  🗺  Space          White controls more space          │   │
│  │                                                      │   │
│  │  Theme [___________]   Notes [___________________]   │   │
│  │                                                      │   │
│  │  [← Prev]  [Skip]  [Easy ✓]  [Medium ✓]  [Hard ✓]  [Next →] │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Saved puzzles: 8   [View Saved]  [Clear All]                │
└──────────────────────────────────────────────────────────────┘
```

### Saved Puzzles Panel

```
┌──────────────────────────────────────────────────────────────┐
│  Saved Puzzles  [Easy: 3]  [Medium: 3]  [Hard: 2]            │
│  ────────────────────────────────────────────────────────── │
│  #1  Rxd4  ??  d5-pawn  Easy   [Delete]                      │
│  #2  Qe7   ??  …        Medium [Delete]                      │
│  …                                                           │
│  [Export JSON]                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
lib/
└── puzzleStore.ts              NEW — Puzzle type, localStorage CRUD

hooks/
└── usePuzzleGenerator.ts       NEW — orchestrates analysis, candidate queue, save flow

components/puzzle-generator/
├── PuzzleGeneratorShell.tsx    NEW — outer layout + PGN input
├── PuzzleReviewCard.tsx        NEW — board + context + accept/skip controls
└── SavedPuzzlesList.tsx        NEW — filter + list + export

app/puzzle-generator/
└── page.tsx                    UPDATE — wire to PuzzleGeneratorShell
```

---

## Implementation Phases

### Phase 1 — Data layer
- [ ] `lib/puzzleStore.ts` — Puzzle type, localStorage helpers (get/save/delete/clear)

### Phase 2 — Hook
- [ ] `hooks/usePuzzleGenerator.ts` — wraps analyseGame or accepts pre-analysed GameReview, manages candidate queue + save flow

### Phase 3 — Components
- [ ] `PuzzleGeneratorShell.tsx` — layout, PGN input, progress, saved count
- [ ] `PuzzleReviewCard.tsx` — board (read-only), eval bar, played/best moves, K-MAPS summary, theme/notes fields, accept/skip controls
- [ ] `SavedPuzzlesList.tsx` — difficulty-filtered list, delete, export JSON

### Phase 4 — Integration
- [ ] Wire `app/puzzle-generator/page.tsx`
- [ ] Accept `?pgn=` query param (forwarded from Board page)
- [ ] Accept `?reviewId=` or session-forwarded `GameReview` from Game Reviewer

---

## Key Constraints

1. **No re-analysis when forwarded from Game Reviewer** — the `GameReview` already has all eval data. Pass it directly to `usePuzzleGenerator`.
2. **Only mistakes and blunders** are candidates — inaccuracies are too numerous and usually not instructive as puzzles.
3. **Puzzle FEN = fenBefore** — the puzzle starts from the position *before* the mistake; the goal is to find the correct move instead.
4. **Solution = bestMoveUci from the engine** — already stored in `ReviewedMove.bestMoveUci`.
5. **localStorage limit** — cap stored puzzles at 200; show warning when approaching limit.
