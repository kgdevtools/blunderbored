# /board Feature Plan

**Route:** `app/board/page.tsx`  
**Status:** ✅ Complete

---

## Feature Summary

A full-featured interactive chess analysis board. Coaches and students can load a PGN, navigate moves, branch into variations, and get continuous Stockfish engine analysis — all in one view.

### Final Layout

```
┌─────────────────────────────────────────────────────────┐
│  [EvalBar]  [Board — responsive width]  [Right Panel   ]│
│                                         [  Move List   ]│
│                                         [  ─────────── ]│
│                                         [  +0.32  SF18 ]│
│                                         [  [ON] [Show] ]│
│                                         [  Engine Lines ]│
│                                         [  ─────────── ]│
│                                         [  ◀◀ ◀ ▶ ▶▶ ⇅ ···]│
│  [FEN input / Copy FEN]                                  │
│  [PGN textarea]  [Copy PGN] [Load PGN]                   │
│  [Export PGN]                                            │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture Decisions

### 1. Game Tree (Variations)
Linked-node tree with in-place mutation + a `treeVersion` counter to invalidate useMemo:

```typescript
interface GameNode {
  id: string;
  fen: string;
  move: Move | null;     // null for root
  parent: GameNode | null;
  children: GameNode[];  // children[0] is main line
}
```

`addMove` deduplicates by SAN so replaying the same move navigates to the existing child.

### 2. Engine — MultiPV
Separate `evaluateMulti(fen, depth, pvCount)` method on `EngineService` — does not touch the existing single-PV `evaluate()` path used by `/analysis`.

### 3. Annotations
`Map<nodeId, { arrows, highlights, history }>` in React state. LIFO history stack for undo. Toggle semantics: same arrow/highlight twice removes it.

### 4. Eval Bar
Position-absolute overlay for score labels eliminates the height discrepancy between the bar and the board.

### 5. Engine Toggle
Two controls: **On/Off** (computation) and **Show/Hide Engine Lines** (display). Disabled-when-off enforced at the button level.

---

## Implementation Tasks

### Phase A — Data layer
- [x] **A1** Define `GameNode` interface in `lib/gameTree.ts`
- [x] **A2** Write helper functions: `createRootNode`, `addMove`, `toMainLinePgn`, `findNode`, `flattenTree`, `deleteMovesBeforeNode`, `deleteMovesAfterNode`
- [x] **A3** Add `evaluateMulti(fen, depth, pvCount)` to `lib/engine.ts`

### Phase B — Hooks
- [x] **B1** `hooks/useBoardGame.ts` — game tree state, navigation, PGN load/export, annotations, tree editing (`deleteMove`, `deleteAfter`)
- [x] **B2** `hooks/useBoardEngine.ts` — MultiPV engine, toggle, auto-reset on crash

### Phase C — Components
- [x] **C1** `EvalBar.tsx` — vertical centipawn bar, absolute-positioned labels, exact board height
- [x] **C2** `MovesList.tsx` — inline variations, LIFO annotation removal, right-click context menu (Delete Move, Delete All Moves After)
- [x] **C3** `EngineLines.tsx` — top-3 lines, prominent eval display, compact typography, On/Off + Show/Hide controls
- [x] **C4** `BoardControls.tsx` — full-width buttons, keyboard shortcuts, 3-dot menu (Game Reviewer, Puzzle Generator, Download PGN)
- [x] **C5** `FenBar.tsx` — FEN input/copy, PGN textarea, Copy PGN, Load PGN, Export PGN
- [x] **C6** `BoardShell.tsx` — full composition, ResizeObserver board width, right-click drag arrows

### Phase D — Annotation system
- [x] **D1** Per-node annotation state in `useBoardGame.ts` with toggle + LIFO undo
- [x] **D2** Right-click detection: `lastHoveredSq` ref + `rightDragStart` ref + wrapper `onMouseDown`

### Phase E — Assembly & page
- [x] **E1** `app/board/page.tsx` renders `<BoardShell />`
- [x] **E2** `?pgn=` query param — server component awaits searchParams, passes to BoardShell
- [x] **E3** `?fen=` query param — same

### Phase F — Polish & edge cases
- [x] **F1** Promotion — library built-in modal works correctly
- [x] **F2** Keyboard shortcuts — ← → Home End F all wired
- [x] **F3** Engine best-move arrow — blue `rgba(0,120,255,0.55)` on board
- [ ] **F4** Disable piece dragging when no legal moves from that square *(deferred)*
- [x] **F5** Board/eval bar width sync via ResizeObserver

---

## Challenges & Resolutions

### 1. TypeScript discriminated-union narrowing in MovesList
After early `return` branches for `var-open` and `var-close`, TypeScript did not narrow `token` to `MoveToken`.  
**Fix:** Added explicit `if (token.kind !== 'move') return null` guard before destructuring.

### 2. Tree mutation + useMemo invalidation
`addMove` mutates `parent.children` in-place, so the `root` reference never changes and `useMemo([root])` never recomputes.  
**Fix:** Added `treeVersion: number` state that increments on every `makeMove`. Used as `useMemo([root, treeVersion])` dependency.

### 3. Right-click drag vs click detection
`onSquareRightClick` only gives the release square; no built-in drag detection.  
**Fix:** Track `lastHoveredSq` via `onMouseOverSquare`, capture `rightDragStart` in the wrapper div's `onMouseDown` when `e.button === 2`. Compare start === end → highlight, start !== end → arrow.

### 4. Engine race condition (stale bestmove)
`cancel()` nulled the resolver then `evaluateMulti` re-set it before the engine responded to the `stop` command. The stale `bestmove` prematurley resolved the new promise.  
**Fix:** `cancel()` sets `skipNextBestmove = true` before sending `stop`. `parseLine` consumes and discards that bestmove response. Removed the duplicate `stop` from inside `evaluateMulti`.

### 5. Stockfish WASM crash — "unreachable executed"
`go depth 18` with `MultiPV 3` caused a hard abort inside the WASM module (memory/stack overflow in the lite single-threaded build).  
**Fix:** Send `setoption name Hash value 4` immediately after `uciok` to cap allocations. Reduced `EVAL_DEPTH` from 18 → 14. On crash, `enabled` resets to `false` so user can retry without a page reload.

### 6. Eval bar height mismatch
Score label spans above/below the bar consumed ~28 px, making the bar visibly shorter than the board.  
**Fix:** Made the outer container `position: relative` at exactly `height={boardWidth}`, score label absolutely positioned inside the bar.

### 7. Next.js 16 `searchParams` type
In Next.js 16 App Router, `searchParams` is a `Promise`. Accessing it synchronously in a server component throws.  
**Fix:** Server component pages are `async` and `await searchParams`. Client content extracted to separate `'use client'` components.

---

## Future Features

- **Move comments** — text annotations per node, displayed below the move list
- **NAG symbols** — `!`, `?`, `!!`, `??`, `!?`, `?!` per move
- **Opening explorer** — show opening name for current position
- **PGN headers** — player names, date, event, result in the load/export flow
- **Engine depth slider** — UI control so user can dial `EVAL_DEPTH` up/down
- **MultiPV count selector** — let user choose 1/2/3 PV lines
- **Sound effects** — click/capture sounds on move
- **Piece animation** — smooth sliding transition between positions
- **Board themes** — piece set and board colour selector
- **Save positions** — persist annotated games to localStorage or a database
- **Share link** — URL that encodes the full game tree (not just current FEN/PGN)
