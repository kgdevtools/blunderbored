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
  reviewData: GameReview | null;
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
  updatedAt: number;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export class ChessAcademyDB extends Dexie {
  folders!: EntityTable<LibraryFolder, 'id'>;
  games!: EntityTable<LibraryGame, 'id'>;
  drafts!: EntityTable<BoardDraft, 'id'>;

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
  }
}

export const db = new ChessAcademyDB();
