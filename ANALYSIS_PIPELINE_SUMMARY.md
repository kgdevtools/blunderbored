# Chess Academy — Project Overview

A Next.js 16 / React 19 chess coaching and training platform. Coaches load PGN games for deep engine analysis; students drill positions, solve puzzles, and train pattern recognition.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Board | `@zoendev/react-chessboard`, `chess.js ^1.4` |
| Engine | Stockfish 18 Lite (single-threaded WASM) via Web Worker |
| State | React hooks only (`useState`, `useRef`, `useMemo`, `useCallback`) |
| Storage | `localStorage` (puzzles); Supabase planned |

---

## Feature Status

| Route | Feature | Status |
|-------|---------|--------|
| `/board` | Interactive analysis board | ✅ Live |
| `/analysis` | Game Reviewer | 🔄 Phase 1 done — Phases 2–4 in progress |
| `/puzzle-generator` | Puzzle Generator | 📋 Planned |
| `/position-trainer` | Position Trainer | 📋 Planned |
| `/learn-from-mistakes` | Learn from Mistakes | 📋 Planned |
| `/coordinate-trainer` | Coordinate Trainer | 📋 Planned |
| `/timed-puzzles` | Timed Puzzles | 📋 Planned |
| `/position-memory` | Position Memory | 📋 Planned |
| `/four-by-four-flash-quiz` | 4×4 Flash Quiz | 📋 Planned |
| `/game-viewer` | Game Viewer | 📋 Planned |
| `/play-with-bot` | Play with Bot | 📋 Planned |

---

## Feature Plan Files

| File | Feature |
|------|---------|
| `BOARD_PLAN.md` | `/board` — Interactive analysis board |
| `GAME_REVIEWER_PLAN.md` | `/analysis` — Game Reviewer |
| `PUZZLE_GENERATOR_PLAN.md` | `/puzzle-generator` — Puzzle Generator |

---

## Engine Architecture

Single `EngineService` instance (`lib/engine.ts`) wrapping a Stockfish 18 Lite WASM Web Worker:

- **`evaluate(fen, depth)`** — single-PV evaluation; returns `{ score, mate, depth, pv }`
- **`evaluateMulti(fen, depth, pvCount)`** — multi-PV evaluation; returns `EngineMultiLine[]`
- **`cancel()`** — stops the current search; `skipNextBestmove` flag eats the stale UCI reply
- Hash capped at 4 MB (`setoption name Hash value 4`) to prevent WASM OOM
- Safe depth limit: **14** (depth 18 with MultiPV overflows the WASM stack)
- On crash: worker is nulled; callers' promises rejected; `enabled` resets so user can retry

The `/board` page uses `evaluateMulti(fen, 14, 3)` (3 PV lines, continuous).  
The Game Reviewer uses `evaluateMulti(fen, 14, 1)` (1 PV per position, batch).

---

## Current File Map

```
lib/
├── engine.ts          Stockfish UCI wrapper — evaluate, evaluateMulti, cancel
├── analysis.ts        Game review pipeline — analyseGame(), ReviewedMove, GameReview
├── accuracy.ts        Lichess formulas — winP, moveAccuracy, classifyQuality, QUALITY_META
├── kmaps.ts           K-MAPS classifier — KmapsResult, all 4 components
├── polyglot.ts        Polyglot book — Random64, polyglotKey, getBookMoves
├── gameTree.ts        Game tree — GameNode, addMove, flattenTree, deleteMovesAfterNode
└── useAnalyser.ts     (legacy) — used by AnalysisClient until Phase 4 replaces it

hooks/
├── useBoardGame.ts    Game tree state, PGN load/export, annotations, tree editing
├── useBoardEngine.ts  MultiPV engine, On/Off toggle, crash recovery
└── useGameReviewer.ts (Phase 2) — wraps analyseGame, progress, navigation

components/
├── board/
│   ├── BoardShell.tsx      Full board page composition
│   ├── EvalBar.tsx         Vertical eval bar
│   ├── MovesList.tsx       Inline variations, right-click context menu
│   ├── EngineLines.tsx     MultiPV lines + On/Off + Show/Hide controls
│   ├── BoardControls.tsx   Navigation + keyboard shortcuts + 3-dot menu
│   └── FenBar.tsx          FEN input, PGN textarea, Copy/Load/Export
├── analysis/
│   └── AnalysisClient.tsx  (legacy) — replaced by game-reviewer/ in Phase 3
└── game-reviewer/          (Phase 3)
    ├── ReviewerShell.tsx
    ├── GameSummary.tsx
    ├── ReviewMoveList.tsx
    └── MoveKmapsPanel.tsx

app/
├── page.tsx           Home — feature grid
├── board/page.tsx     Board page (async server component, passes ?pgn= ?fen=)
└── analysis/page.tsx  Game Reviewer page (async server component, passes ?pgn=)

public/
├── engine/            stockfish-18-lite-single.js + .wasm
└── books/             gm2600.bin (Polyglot book — download separately, not in repo)
```

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| WASM crash (`unreachable executed`) | Keep depth ≤ 14; Hash ≤ 4 MB |
| Stale `bestmove` from cancelled search | `skipNextBestmove` flag in `cancel()` |
| `searchParams` in Next.js 16 server components | `searchParams` is a `Promise` — must `await` it |
| `chess.board()` row 0 = rank 8 | Rank index = `7 - row`; square index = `rank * 8 + file` |
| Turbopack stale cache (deleted function still referenced) | Restart dev server |
| BigInt literals require ES2020 target | `tsconfig.json` → `"target": "ES2020"` |
