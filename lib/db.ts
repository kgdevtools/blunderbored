import Dexie, { type EntityTable } from 'dexie';
import type { GameReview } from './analysis';
import type { NodeAnnotation, NodeMeta } from './gameTree';
import type { BlunderMove } from './blunder';
import type { ArrowDecoration, HighlightDecoration, AnimationDecoration } from './decorations';
import type { MoveQuality } from './accuracy';

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryEntry = { kind: 'arrow' | 'highlight' | 'animation'; id: string };

export interface StoredAnnotation {
  arrows: ArrowDecoration[];
  highlights: HighlightDecoration[];
  // Purely additive (v7) — optional field on a non-indexed column, so no Dexie
  // migration is needed; older rows simply lack it.
  animations?: AnimationDecoration[];
  history: HistoryEntry[];
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  depth: number; // 1 | 2 | 3
  createdAt: number;
  updatedAt: number;
}

export interface LibraryGame {
  id: string;
  folderId: string;
  title: string;
  pgn: string;
  headers: Record<string, string>;
  nodeComments: Record<string, NodeAnnotation[]>; // nodeId → source-tagged comments (v4; was string pre-v4)
  nodeMeta?: Record<string, NodeMeta>;         // nodeId → clk/eval parsed from PGN. Optional: pre-v4 rows lack it.
  annotations: Record<string, StoredAnnotation>; // nodeId → arrows/highlights
  nags?: Record<string, number[]>;             // nodeId → NAG codes (e.g. [1] = !). Optional: pre-v3 rows lack it.
  // Duplicate-detection fingerprint of the movetext, cached at import time so
  // later imports don't recompute it for every existing row. Optional: older
  // rows lack it and fall back to computing from the PGN. Not indexed, so no
  // schema version bump is needed (Dexie migrations must stay additive).
  fingerprint?: string;
  reviewData: GameReview | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Graph layer (v3) ───────────────────────────────────────────────────────

// A concept node in the knowledge graph. Either auto-seeded from a game's ECO/
// Opening header ('opening') or hand-authored by the user ('theme' | 'custom').
export interface ConceptNode {
  id: string;
  name: string;
  family: string;            // drives node colour — ECO letter A–E for openings, else a theme family
  kind: 'opening' | 'theme' | 'custom';
  eco?: string;              // set for auto-seeded opening concepts; the find-or-create key
  origin: 'auto' | 'manual';
  createdAt: number;
  updatedAt: number;
}

// A directed edge in the graph. Everything that isn't free text or a NAG is an
// edge. A move-anchored *ref* is an edge with `sourceNodeId` set (the gameTree
// node id the ref originates from). `origin` lets a re-import refresh auto edges
// without disturbing hand-made ones.
export interface GraphEdge {
  id: string;
  type: 'concept-concept' | 'concept-game' | 'game-game' | 'concept-position';
  source: string;            // ConceptNode.id, LibraryGame.id or SavedPosition.id
  target: string;            // ConceptNode.id, LibraryGame.id or SavedPosition.id
  sourceNodeId?: string;     // set ⇒ move-anchored ref within the source game
  origin: 'auto' | 'manual';
  label?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Saved positions (v6) ─────────────────────────────────────────────────────

// A position bookmarked for practice/study in /blunderable. Self-contained (the
// FEN + relaunch defaults), and a first-class node in the concept graph — tagged
// to concepts via `concept-position` edges (source = concept, target = position).
export interface SavedPosition {
  id: string;
  fen: string;
  side: 'w' | 'b';          // the side you practise
  title: string;
  note?: string;
  // Defaults to relaunch the challenge with (mirrors the setup config).
  ratingElo?: number;
  target?: number;
  clockInitialMs?: number;
  clockIncMs?: number;
  source?: 'blunderable' | 'board' | 'manual';
  createdAt: number;
  updatedAt: number;
  // Practice stats (lightweight; SRS scheduling layered on later).
  lastPracticedAt?: number;
  timesPracticed?: number;
  lastResult?: 'succeeded' | 'failed';
}

// The board autosaves its in-progress state to a single draft row so an
// accidental reload doesn't lose unsaved analysis. Keyed by a constant id.
export interface BoardDraft {
  id: string; // always 'board-current'
  pgn: string;
  headers: Record<string, string>;
  nodeComments: Record<string, NodeAnnotation[]>;
  nodeMeta?: Record<string, NodeMeta>;
  annotations: Record<string, StoredAnnotation>;
  nags?: Record<string, number[]>;
  updatedAt: number;
}

// v3→v4 conversion: nodeComments moved from a single string per node to a list
// of source-tagged annotations. Existing comments were user-authored, so they
// become source 'manual'.
function migrateNodeComments(old: unknown): Record<string, NodeAnnotation[]> {
  const out: Record<string, NodeAnnotation[]> = {};
  if (!old || typeof old !== 'object') return out;
  for (const [nodeId, val] of Object.entries(old as Record<string, unknown>)) {
    if (typeof val === 'string') {
      if (val.trim()) out[nodeId] = [{ source: 'manual', text: val }];
    } else if (Array.isArray(val)) {
      out[nodeId] = val as NodeAnnotation[]; // already migrated
    }
  }
  return out;
}

// A finished /blunderable challenge, kept for the history list. Self-contained
// (no FKs) so it survives independently of the library.
export interface ChallengeReport {
  id: string;
  side: 'w' | 'b';
  startFen: string;
  target: number;
  result: 'succeeded' | 'failed';
  e0Cp: number;            // starting eval, player POV (cp)
  moves: BlunderMove[];
  createdAt: number;
  // Optional (current model) — older records simply omit these.
  ratingElo?: number | null;     // opponent strength (null = full strength)
  clockInitialMs?: number;       // per-side starting time
  clockIncMs?: number;           // increment per move
  endReason?: 'blunder' | 'drift' | 'regression' | 'flagged' | 'target' | 'mate' | 'manual';
  cumulativeWp?: number;         // total self-inflicted win% loss
  toEnd?: boolean;               // run was "play to the end" (target ignored)
}

// ─── Puzzles + spaced repetition (v7) ─────────────────────────────────────────
// A puzzle built from a flagged (mistake/blunder) move in an analysed game —
// hand-picked via Game Analysis's puzzle mode (click a flagged move, pick one
// of its engine variations). 'avoid-blunder' starts from the position
// *before* the mistake and is solved by the move that should have been
// played; 'punish-blunder' is a legacy kind from an earlier batch-generation
// flow (position *after* the mistake, solved by the refutation) — no longer
// produced, kept for puzzles saved before this changed.
export interface Puzzle {
  id: string;
  fen: string;             // position to solve from
  solutionUci: string;     // first solution move (kept for learn-from-mistakes back-compat)
  // The full winning variation (UCI, solver's move first, opponent replies
  // interleaved) — the engine PV at extraction, extended to ≥6 half-moves
  // unless checkmate ends it sooner. Solve mode replays this line. Optional:
  // pre-v8 puzzles only carry the single move.
  solutionLineUci?: string[];
  // Alternate acceptable FIRST moves: when the engine's two best moves were
  // near-equal (≤30cp apart) at extraction, either is a correct start — the
  // solver isn't punished for picking the co-best move.
  altFirstMovesUci?: string[];
  kind: 'avoid-blunder' | 'punish-blunder';
  sourceGameId?: string;   // LibraryGame.id, when generated from a saved game
  sourcePly?: number;
  severity: MoveQuality;   // classification at extraction time
  winPctLoss: number;      // carried over from ReviewedMove — a difficulty proxy
  createdAt: number;
  // User-entered metadata, set in the puzzle batch-edit modal before saving.
  title?: string;
  note?: string;
  // The move that produced `fen` — the opponent's last move for an
  // avoid-blunder puzzle, or the blunder itself for a punish-blunder puzzle.
  // Lets Solve mode highlight "what just happened" (Lichess-style) even for
  // a puzzle reopened from a saved workout, with no live GameReview around.
  leadingMoveUci?: string;
  leadingMoveSan?: string;
  // Hand-authored puzzles (Puzzle Create page) only, below — optional so
  // engine-generated puzzles (no Dexie migration needed) simply lack them.
  themes?: string[];        // chip tags, shown in Puzzle Set tab + Edit tab
  // Full authored tree (incl. sidelines explored while building the puzzle),
  // serialised via lib/gameTree.ts's toPgnWithVariations. Reference-only: shown
  // in Preview as extra lines to look at, never parsed back into solve-mode
  // grading (which always uses solutionLineUci above).
  annotationPgn?: string;
}

// A named, saved set of puzzles ("workout") — created from the Puzzle
// Generator's "Save Set", listed under the Library modal's Workouts tab.
export interface WorkoutSet {
  id: string;
  name: string;
  puzzleIds: string[];
  sourceGameId?: string;
  createdAt: number;
  // Time allocated for the whole set (chosen once, at creation) — undefined
  // means untimed. This is a set-level setting, not per-puzzle: Solve mode
  // starts the clock (or doesn't) based on this rather than asking each time.
  timerSeconds?: number;
}

// Unused since the batch severity-filter generation flow was replaced by
// hand-picking puzzles move-by-move — kept (not deleted) so existing Dexie
// installs don't need a destructive schema change for an empty table.
export interface PuzzleGenDraft {
  id: string;              // movetext fingerprint (lib/library.ts)
  pgn: string;
  severity: string;
  puzzleIds: string[];
  flaggedMoveCount: number;
  createdAt: number;
}

// Leitner spaced-repetition state for one puzzle (1:1 with Puzzle.id).
// Box scheme mirrors Lucas Chess's Leitner.py: 0 = untried, 1-4 = in
// progress, 5 = mastered ("win box"). Due-scheduling is session-counted, not
// wall-clock: a box-N item is due again N sessions after `lastSessionNum`
// (see lib/leitner.ts) — one visit to /learn-from-mistakes that pulls a
// batch of puzzles is "one session".
export interface LeitnerBox {
  puzzleId: string;
  box: number;
  lastSessionNum: number;
  rightCount: number;
  wrongCount: number;
  masteredAtSession?: number; // session number when box first reached WIN_BOX
}

// ─── Database ─────────────────────────────────────────────────────────────────

export class ChessAcademyDB extends Dexie {
  folders!: EntityTable<LibraryFolder, 'id'>;
  games!: EntityTable<LibraryGame, 'id'>;
  drafts!: EntityTable<BoardDraft, 'id'>;
  conceptNodes!: EntityTable<ConceptNode, 'id'>;
  graphEdges!: EntityTable<GraphEdge, 'id'>;
  challenges!: EntityTable<ChallengeReport, 'id'>;
  savedPositions!: EntityTable<SavedPosition, 'id'>;
  puzzles!: EntityTable<Puzzle, 'id'>;
  leitnerBoxes!: EntityTable<LeitnerBox, 'puzzleId'>;
  workoutSets!: EntityTable<WorkoutSet, 'id'>;
  puzzleGenDrafts!: EntityTable<PuzzleGenDraft, 'id'>;

  constructor() {
    super('chess-academy');
    this.version(1).stores({
      folders: 'id, parentId, depth, createdAt, updatedAt',
      games:   'id, folderId, createdAt, updatedAt',
    });
    // v2 adds the single-slot board autosave draft. Unchanged tables carry over.
    this.version(2).stores({
      drafts: 'id, updatedAt',
    });
    // v3 adds the graph layer. Purely additive — no existing store is altered,
    // so reverting to v2 code leaves these tables dormant rather than broken.
    // (`nags` on games/drafts is an optional field; IndexedDB needs no index for it.)
    this.version(3).stores({
      conceptNodes: 'id, family, kind, eco, origin, updatedAt',
      graphEdges:   'id, type, source, target, sourceNodeId, origin, updatedAt, [source+type], [target+type]',
    });
    // v4 makes nodeComments source-tagged (string → NodeAnnotation[]) and adds
    // the optional nodeMeta (clk/eval). No index changes — data-only upgrade
    // over games + drafts. nodeMeta defaults to undefined, so no backfill needed.
    this.version(4).stores({}).upgrade(async (tx) => {
      await tx.table('games').toCollection().modify((g) => {
        g.nodeComments = migrateNodeComments(g.nodeComments);
      });
      await tx.table('drafts').toCollection().modify((d) => {
        d.nodeComments = migrateNodeComments(d.nodeComments);
      });
    });
    // v5 adds the /blunderable challenge history. Purely additive.
    this.version(5).stores({
      challenges: 'id, result, createdAt',
    });
    // v6 adds saved positions (practice bookmarks). Purely additive — existing
    // tables and data are untouched, so older code just leaves it dormant.
    this.version(6).stores({
      savedPositions: 'id, source, createdAt, updatedAt, lastPracticedAt',
    });
    // v7 adds puzzles (tactics generator) + their Leitner SRS state. Purely
    // additive — existing tables and data are untouched.
    this.version(7).stores({
      puzzles: 'id, sourceGameId, kind, createdAt',
      leitnerBoxes: 'puzzleId, box, lastSessionNum',
    });
    // v8 adds workout sets (saved puzzle sets → Library "Workouts" tab) and
    // the puzzle-generator draft cache. Purely additive. (Puzzle gains the
    // optional solutionLineUci/altFirstMovesUci fields — non-indexed, no
    // migration needed; pre-v8 rows simply lack them.)
    this.version(8).stores({
      workoutSets: 'id, createdAt',
      puzzleGenDrafts: 'id, createdAt',
    });
  }
}

export const db = new ChessAcademyDB();
