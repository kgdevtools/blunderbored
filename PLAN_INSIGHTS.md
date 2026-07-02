# Insights & Concepts Revamp — Implementation Plan (approved v2)

Status: all design decisions approved 2026-07-02. This is the implementation
plan for review before any code is written. Workflow per project rule: each
phase is eslint + `tsc --noEmit` checked, then STOPS for user review; nothing
staged or committed.

## Why (from the audit)

- **Concepts** was 100% ECO-seeded openings — but a concept is any chess theme
  (Passed Pawn, Lucena, Good Knight vs Bad Bishop, Discovered Attack, Critical
  Positions). The edge model already supported this; the seeding and UI didn't.
- **Graph** (force network) encoded only family color + game-count bubble size
  over an auto-derived tree. Decoration, not insight. Cut.
- **PerformanceCharts** read only Blunderable challenges while the richest
  dataset — `reviewData: GameReview` per analysed game (per-move quality,
  phase, cpLoss, accuracy, kmaps) — fed nothing.

Goal: chess.com-Insights-style analytics over the user's own games. Build only
what is useful.

## Mental model

1. **Openings** = a dimension of every game (headers), computed at read time.
2. **Concepts** = curated knowledge base: definition + category + linked
   examples (games, move-anchored refs, saved positions).
3. **Insights** = the analytics dashboard ("where do I lose points?").

## Approved decisions

| Decision | Resolution |
|---|---|
| Player identity | `myAliases` setting → derived per-game `mySide`, overridable per game |
| Force graph | Cut entirely (git history keeps it) |
| Taxonomy | Seed ~40 curated concepts with definitions, editable/deletable |
| Placement | Library modal; tabs `Folders · Concepts · Insights · Positions`; Openings is a section of Insights |
| Migration | Purge auto opening concepts **unless user-touched** (has a manual edge, or updatedAt > createdAt i.e. renamed) |
| Insights scope | Whole library always, with its own filters (format, date range, color) |
| Phasing | Four phases (A–D below), each reviewed before the next |

## Metric definitions

| Metric | Definition | Source | Coverage |
|---|---|---|---|
| Score % | (wins + ½·draws) / attributed games | Result header + mySide | all attributed games |
| Accuracy | mean of my side's per-game accuracy | analyticsSummary (from reviewData) | analysed games only |
| Blunder rate | my blunders per game, split by phase | analyticsSummary | analysed games only |
| Opening | `baseOpeningName()` (text before ":"), else Opening header, else ECO | headers | all games |

Honesty rule: every section states its sample size ("41 of 268 games
analysed"); header-only and review-based metrics are never silently mixed.
Unattributed games are excluded from "you" metrics with a visible note and a
one-click path to the alias setting.

---

## Phase A — Identity & settings

**Data (`lib/db.ts`)** — additive only, per the persistence rule:
- New `settings` table: `{ key: string; value: unknown }`, keyed on `key`
  (requires a Dexie `version(n+1).stores()` bump — additive, no data touched).
- `LibraryGame.mySide?: 'w' | 'b' | null` — non-indexed, no schema change.
  `null` = checked, no match; `undefined` = not yet computed (backfill needed).

**Logic:**
- `lib/settings.ts`: `getMyAliases(): Promise<string[]>`, `setMyAliases()`.
- `lib/identity.ts`: `matchMySide(headers, aliases): 'w' | 'b' | null` —
  trim + case-insensitive exact match on White/Black headers; if both match,
  White wins (self-play edge case).
- Import path (`buildGameRow`, `saveGame`): compute `mySide` at save time.
- Lazy backfill: on Insights open, batch-update games with `mySide ===
  undefined`, reusing the yield/batch pattern from the import pipeline.
  Re-runs when aliases change (recompute all — cheap, header-only).

**UI:**
- Insights tab empty/setup state: "Add your usernames to unlock score and
  accuracy stats" → inline alias editor (comma-separated chips).
- `GameInfoModal`: "My side: White / Black / Not me" override row.

## Phase B — Insights aggregations + dashboard

**Data:** `LibraryGame.analyticsSummary?` (non-indexed, additive), written when
a review completes and lazily backfilled from existing `reviewData` (one pass,
batched):

```ts
interface SideAnalytics {
  accuracy: number;
  // per phase: total my moves, and counts of inaccuracy/mistake/blunder
  phases: Record<'opening' | 'middlegame' | 'endgame',
                 { moves: number; inaccuracies: number; mistakes: number; blunders: number }>;
}
interface AnalyticsSummary { w: SideAnalytics; b: SideAnalytics; v: 1 }
```

Aggregations never deserialize full `reviewData` (which carries per-move FENs +
kmaps and is too heavy to scan on every dashboard open).

**Logic (`lib/insights.ts`):**
- `InsightsScope = { format?: GameFormat; dateFrom?: string; dateTo?: string; color?: 'w' | 'b' }`
- `overviewStats(scope)` → games, attributed, analysed, score% overall/White/Black, mean accuracy.
- `openingsTable(scope)` → rows `{ opening, eco, games, scorePct, accuracy | null, asWhite, asBlack }`, min 2 games to appear, sorted by games.
- `phaseMistakes(scope)` → per phase: my blunders+mistakes per game.
- `accuracyTrend(scope)` → `{ date, accuracy }[]` ordered by PGN date (fallback: updatedAt).

**UI (`components/board/InsightsView.tsx`):** replaces the Graph tab. Sections
top-to-bottom (scrollable), scope filter bar pinned at top:
1. **Overview** — stat tiles (dataviz skill conventions for tiles/charts).
2. **Openings** — the table, color toggle, worst-lines callout.
3. **Phases & mistakes** — grouped bars by phase.
4. **Trend** — accuracy over time line.
5. **Training** — existing Blunderable spider/trend/bands/scatter fold in here
   (PerformanceCharts reused as a section; graph sub-tab strip removed).

`LibraryModal`: tab strip becomes `folders · concepts · insights · positions`.

## Phase C — Concepts revamp

**Data:** `ConceptNode` gains `category?: 'tactics' | 'strategy' | 'endgames'
| 'positions'` and `definition?: string` (non-indexed, additive). `origin`
union extended with `'seeded'`.

**Seeding (`lib/conceptSeed.ts`):** idempotent by stable slug (re-running never
duplicates; user deletions are respected via a `seededConceptsTombstones`
settings key so deleted seeds don't resurrect).

**Seed taxonomy (~40) — review this list:**

*Tactics:* Fork · Pin · Skewer · Discovered Attack · Double Check · Deflection
· Decoy · Overloading · Removing the Defender · Zwischenzug · Back-Rank
Weakness · Trapped Piece · Interference · Clearance Sacrifice

*Strategy:* Passed Pawn · Outpost · Good Knight vs Bad Bishop · Bishop Pair ·
Open File Control · Weak Color Complex · Pawn Breaks · Isolated Queen's Pawn ·
Space Advantage · Prophylaxis · Exchange Sacrifice · Pawn Storm / King Attack

*Endgames:* Lucena Position · Philidor Position · Opposition · Triangulation ·
Zugzwang · Wrong-Colored Bishop · Rook Behind Passed Pawn · Vancura Position ·
Fortress · King Activity

*Key Positions:* Critical Position · Model Game · Opening Trap · Prepared
Novelty

Each ships with a one-line definition (drafted during implementation, visible
and editable in the UI).

**UI (`ConceptList` rework):**
- Grouped by category with counts; concept row = color dot (per category, not
  ECO family), name, definition line, linked counts (games / move-refs /
  positions); expand shows examples (kept from current UI).
- Definition editable inline alongside rename.
- Tagging: existing move-ref flow (RefLinker) stays the primary mechanism; add
  a "Tag concept" picker in `GameInfoModal` for whole-game tags.

## Phase D — Migration & graph removal

**Migration (one-shot, guarded by a settings flag `migratedOpeningConcepts`):**
- Delete `origin === 'auto'` opening concepts and their `origin === 'auto'`
  edges, EXCEPT concepts that (a) have any manual edge referencing them, or
  (b) were renamed (`updatedAt > createdAt` — rename is the only concept
  update path). Kept concepts get `kind` left as-is so nothing dangles.
- Never touches manual concepts, manual edges, games, or positions
  (per the storage-persistence rule).

**Removal:**
- `components/board/GraphView.tsx` deleted; graph sub-tab strip in
  `LibraryModal` deleted.
- `egoNetwork`, `conceptLevelGraph` removed from `lib/edges.ts`.
- `ensureOpeningConcept` / `ensureOpeningHierarchy` and the
  `seedConceptsForGame(s)` call sites in `lib/library.ts` removed — imports no
  longer materialize opening concepts (faster imports, too).
- `colorForFamily` replaced by per-category colors; ECO family colors retired.

## Out of scope (explicitly)

- Auto-tagging concepts from kmaps/review data (passed pawns, king-safety) —
  future phase once manual tagging proves out.
- A dedicated /insights page — everything stays in the modal for now.
- Time-management analytics from [%clk] — promising later addition, not now.

## Verification per phase

`npx eslint <changed files>` + `npx tsc --noEmit`; manual smoke notes provided
per phase for user testing (no builds, no staging, per workflow rule).
