import { nanoid } from 'nanoid';
import { db, LibraryFolder, LibraryGame, StoredAnnotation, BoardDraft } from './db';
import type { GameReview } from './analysis';

// ─── Duplicate detection ──────────────────────────────────────────────────────

function movesFingerprint(pgn: string): string {
  return pgn
    .replace(/\[[^\]]*\]/g, '')  // strip header tags
    .replace(/\{[^}]*\}/g, '')   // strip comments
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function checkDuplicate(folderId: string, pgn: string): Promise<boolean> {
  const fp = movesFingerprint(pgn);
  if (!fp) return false;
  const existing = await db.games.where('folderId').equals(folderId).toArray();
  return existing.some(g => movesFingerprint(g.pgn) === fp);
}

// ─── Folder CRUD ──────────────────────────────────────────────────────────────

export async function createFolder(name: string, parentId?: string | null): Promise<LibraryFolder> {
  const pid = parentId ?? null;
  let depth = 1;

  if (pid) {
    const parent = await db.folders.get(pid);
    if (!parent) throw new Error('Parent folder not found');
    depth = parent.depth + 1;
    if (depth > 3) throw new Error('Maximum folder depth (3) reached');
  }

  const folder: LibraryFolder = {
    id: nanoid(),
    name: name.trim() || 'New Folder',
    parentId: pid,
    depth,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name: name.trim() || 'New Folder', updatedAt: Date.now() });
}

export async function deleteFolder(id: string): Promise<void> {
  // Recursively collect all descendant folder ids
  const allIds: string[] = [];

  async function collect(folderId: string) {
    allIds.push(folderId);
    const children = await db.folders.where('parentId').equals(folderId).toArray();
    for (const child of children) {
      await collect(child.id);
    }
  }

  await collect(id);

  // Delete all games in those folders, then the folders themselves
  await db.transaction('rw', db.games, db.folders, async () => {
    for (const fid of allIds) {
      await db.games.where('folderId').equals(fid).delete();
    }
    await db.folders.bulkDelete(allIds);
  });
}

// ─── Game CRUD ────────────────────────────────────────────────────────────────

export type SaveGamePayload = Omit<LibraryGame, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveGame(payload: SaveGamePayload): Promise<LibraryGame> {
  const game: LibraryGame = {
    ...payload,
    id: nanoid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.games.add(game);
  return game;
}

export async function updateGame(id: string, partial: Partial<Omit<LibraryGame, 'id' | 'createdAt'>>): Promise<void> {
  await db.games.update(id, { ...partial, updatedAt: Date.now() });
}

export async function deleteGame(id: string): Promise<void> {
  await db.games.delete(id);
}

// ─── Serialization ────────────────────────────────────────────────────────────

export interface BoardStateSnapshot {
  exportPgn: () => string;
  headers: Record<string, string>;
  nodeComments: Map<string, string>;
  allAnnotations: Map<string, StoredAnnotation>;
}

export function serializeBoardState(
  folderId: string,
  snapshot: BoardStateSnapshot,
  reviewData?: GameReview | null,
): SaveGamePayload {
  const pgn = snapshot.exportPgn();

  const nodeComments: Record<string, string> = {};
  snapshot.nodeComments.forEach((v, k) => { nodeComments[k] = v; });

  const annotations: Record<string, StoredAnnotation> = {};
  snapshot.allAnnotations.forEach((v, k) => { annotations[k] = v; });

  return {
    folderId,
    title: deriveTitle(snapshot.headers),
    pgn,
    headers: { ...snapshot.headers },
    nodeComments,
    annotations,
    reviewData: reviewData ?? null,
  };
}

// ─── Board draft (single-slot autosave) ───────────────────────────────────────

const DRAFT_ID = 'board-current';

export async function saveDraft(snapshot: BoardStateSnapshot): Promise<void> {
  // Reuse the library serializer (Map → Record conversion) then drop the
  // library-only fields the draft doesn't need.
  const { pgn, headers, nodeComments, annotations } = serializeBoardState('', snapshot);
  const draft: BoardDraft = {
    id: DRAFT_ID,
    pgn,
    headers,
    nodeComments,
    annotations,
    updatedAt: Date.now(),
  };
  await db.drafts.put(draft);
}

export async function loadDraft(): Promise<BoardDraft | undefined> {
  return db.drafts.get(DRAFT_ID);
}

export async function clearDraft(): Promise<void> {
  await db.drafts.delete(DRAFT_ID);
}

export function deriveTitle(headers: Record<string, string>): string {
  const white = headers.White?.trim() || '?';
  const black = headers.Black?.trim() || '?';
  return `${white} vs ${black}`;
}

// ─── Multi-game PGN parsing ───────────────────────────────────────────────────

export interface ParsedPgnGame {
  pgn: string;
  headers: Record<string, string>;
  title: string;
}

export function parsePgnGames(content: string): ParsedPgnGame[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // Split at blank lines that precede a new PGN header block.
  // Standard PGN header tags start with [Key "Value"].
  const chunks = normalized.split(/\n{2,}(?=\[(?:Event|White|Black|Round|Date|Result|Site|ECO|Opening)\s*")/);

  const results: ParsedPgnGame[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('[')) continue;

    const headers: Record<string, string> = {};
    for (const m of trimmed.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) {
      headers[m[1]] = m[2];
    }
    if (Object.keys(headers).length === 0) continue;

    results.push({ pgn: trimmed, headers, title: deriveTitle(headers) });
  }

  return results;
}
