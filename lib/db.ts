import Dexie, { type EntityTable } from 'dexie';
import type { GameReview } from './analysis';

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
  nodeComments: Record<string, string>;       // nodeId → comment text
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
  type: 'concept-concept' | 'concept-game' | 'game-game';
  source: string;            // ConceptNode.id or LibraryGame.id
  target: string;            // ConceptNode.id or LibraryGame.id
  sourceNodeId?: string;     // set ⇒ move-anchored ref within the source game
  origin: 'auto' | 'manual';
  label?: string;
  createdAt: number;
  updatedAt: number;
}

// The board autosaves its in-progress state to a single draft row so an
// accidental reload doesn't lose unsaved analysis. Keyed by a constant id.
export interface BoardDraft {
  id: string; // always 'board-current'
  pgn: string;
  headers: Record<string, string>;
  nodeComments: Record<string, string>;
  annotations: Record<string, StoredAnnotation>;
  nags?: Record<string, number[]>;
  updatedAt: number;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export class ChessAcademyDB extends Dexie {
  folders!: EntityTable<LibraryFolder, 'id'>;
  games!: EntityTable<LibraryGame, 'id'>;
  drafts!: EntityTable<BoardDraft, 'id'>;
  conceptNodes!: EntityTable<ConceptNode, 'id'>;
  graphEdges!: EntityTable<GraphEdge, 'id'>;

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
  }
}

export const db = new ChessAcademyDB();
