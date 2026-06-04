import { nanoid } from 'nanoid';
import { db, LibraryFolder, LibraryGame, GraphEdge, StoredAnnotation, BoardDraft } from './db';
import type { GameReview } from './analysis';
import { ensureOpeningConcept, ensureOpeningHierarchy } from './concepts';
import { ensureConceptGameEdge, deleteEdgesForGame } from './edges';

// Auto-seed: derive an opening concept from a game's ECO/Opening headers and
// link it to the game (origin 'auto'). Idempotent and best-effort — a failure
// here must never block the save itself.
async function seedConceptsForGame(game: LibraryGame): Promise<void> {
  try {
    const concept = await ensureOpeningConcept(game.headers.ECO, game.headers.Opening);
    if (concept) await ensureConceptGameEdge(concept.id, game.id, 'auto');
    await ensureOpeningHierarchy();
  } catch {
    /* graph seeding is non-critical */
  }
}

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
  await seedConceptsForGame(game);
  return game;
}

export async function updateGame(id: string, partial: Partial<Omit<LibraryGame, 'id' | 'createdAt'>>): Promise<void> {
  await db.games.update(id, { ...partial, updatedAt: Date.now() });
}

export async function deleteGame(id: string): Promise<void> {
  await db.games.delete(id);
  await deleteEdgesForGame(id);
}

// ─── Bulk import ──────────────────────────────────────────────────────────────

// Imports many parsed games into a folder in a single pass. Avoids the O(N²)
// memory/CPU blow-up of calling checkDuplicate + saveGame per game (each of
// which reloaded the whole folder): existing fingerprints are loaded ONCE, the
// batch is de-duped in memory, and rows + edges are inserted with bulkAdd.
export async function importGames(
  folderId: string,
  parsed: ParsedPgnGame[],
): Promise<{ saved: number; dupes: number }> {
  const existing = await db.games.where('folderId').equals(folderId).toArray();
  const seen = new Set(existing.map((g) => movesFingerprint(g.pgn)));

  const now = Date.now();
  const rows: LibraryGame[] = [];
  let dupes = 0;
  for (const g of parsed) {
    const fp = movesFingerprint(g.pgn);
    if (!fp || seen.has(fp)) { dupes++; continue; }
    seen.add(fp);
    rows.push({
      id: nanoid(),
      folderId,
      title: g.title,
      pgn: g.pgn,
      headers: g.headers,
      nodeComments: {},
      annotations: {},
      reviewData: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (rows.length === 0) return { saved: 0, dupes };

  await db.games.bulkAdd(rows);
  await seedConceptsForGames(rows);
  return { saved: rows.length, dupes };
}

// Batch concept seeding: ensure each unique ECO concept once, then bulk-add the
// concept→game edges (rows are brand-new, so no edge de-dup needed).
async function seedConceptsForGames(rows: LibraryGame[]): Promise<void> {
  try {
    const ecoToConcept = new Map<string, string>();
    for (const r of rows) {
      const eco = (r.headers.ECO ?? '').trim();
      if (!eco || ecoToConcept.has(eco)) continue;
      const c = await ensureOpeningConcept(eco, r.headers.Opening);
      if (c) ecoToConcept.set(eco, c.id);
    }
    if (ecoToConcept.size === 0) return;

    const now = Date.now();
    const edges: GraphEdge[] = [];
    for (const r of rows) {
      const conceptId = ecoToConcept.get((r.headers.ECO ?? '').trim());
      if (!conceptId) continue;
      edges.push({
        id: nanoid(),
        type: 'concept-game',
        source: conceptId,
        target: r.id,
        origin: 'auto',
        createdAt: now,
        updatedAt: now,
      });
    }
    if (edges.length) await db.graphEdges.bulkAdd(edges);
    await ensureOpeningHierarchy();
  } catch {
    /* graph seeding is non-critical */
  }
}

// ─── Serialization ────────────────────────────────────────────────────────────

export interface BoardStateSnapshot {
  exportPgn: () => string;
  headers: Record<string, string>;
  nodeComments: Map<string, string>;
  allAnnotations: Map<string, StoredAnnotation>;
  nags?: Map<string, number[]>;
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

  const nags: Record<string, number[]> = {};
  snapshot.nags?.forEach((v, k) => { if (v.length) nags[k] = v; });

  return {
    folderId,
    title: deriveTitle(snapshot.headers),
    pgn,
    headers: { ...snapshot.headers },
    nodeComments,
    annotations,
    nags,
    reviewData: reviewData ?? null,
  };
}

// ─── Board draft (single-slot autosave) ───────────────────────────────────────

const DRAFT_ID = 'board-current';

export async function saveDraft(snapshot: BoardStateSnapshot): Promise<void> {
  // Reuse the library serializer (Map → Record conversion) then drop the
  // library-only fields the draft doesn't need.
  const { pgn, headers, nodeComments, annotations, nags } = serializeBoardState('', snapshot);
  const draft: BoardDraft = {
    id: DRAFT_ID,
    pgn,
    headers,
    nodeComments,
    annotations,
    nags,
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
