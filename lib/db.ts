import Dexie, { type EntityTable } from 'dexie';
import type { GameReview } from './analysis';
import type { NodeAnnotation, NodeMeta } from './gameTree';
import type { BlunderMove } from './blunder';

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoryEntry =
  | { kind: 'arrow'; from: string; to: string }
  | { kind: 'highlight'; square: string };

export interface StoredAnnotation {
  arrows: [string, string][];
  highlights: string[];
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
  endReason?: 'blunder' | 'drift' | 'flagged' | 'target' | 'mate';
  cumulativeWp?: number;         // total self-inflicted win% loss
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
  }
}

export const db = new ChessAcademyDB();
