import { nanoid } from 'nanoid';
import { db, LibraryFolder, LibraryGame, GraphEdge, StoredAnnotation, BoardDraft } from './db';
import type { GameReview } from './analysis';
import type { GameNode, NodeAnnotation, NodeMeta } from './gameTree';
import { parseGameAnnotations } from './pgnImport';
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
    rows.push(buildGameRow(folderId, g, now));
  }

  if (rows.length === 0) return { saved: 0, dupes };

  await db.games.bulkAdd(rows);
  await seedConceptsForGames(rows);
  return { saved: rows.length, dupes };
}

// Builds a LibraryGame row, parsing the PGN's own comments / clk / eval / arrows
// / NAGs into ply-keyed structured data so an imported game shows its
// annotations on the board — the same data the board produces loading the PGN.
function buildGameRow(folderId: string, g: ParsedPgnGame, now: number): LibraryGame {
  const ann = parseGameAnnotations(g.pgn);
  return {
    id: nanoid(),
    folderId,
    title: g.title,
    pgn: g.pgn,
    headers: g.headers,
    nodeComments: ann?.nodeComments ?? {},
    nodeMeta: ann?.nodeMeta ?? {},
    annotations: ann?.annotations ?? {},
    nags: ann?.nags ?? {},
    reviewData: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Import with conflict resolution ──────────────────────────────────────────

export interface ImportConflict {
  incoming: ParsedPgnGame;
  existingId: string;
  existingTitle: string;
}

export interface ImportAnalysis {
  fresh: ParsedPgnGame[];      // no existing match — safe to add
  conflicts: ImportConflict[]; // same moves as a game already in the folder
}

// Splits a parsed batch into brand-new games and ones that duplicate an existing
// game in the folder, so the UI can ask the user how to resolve rather than
// silently skipping. Intra-batch duplicates are collapsed to the first instance.
export async function analyzeImport(
  folderId: string,
  parsed: ParsedPgnGame[],
): Promise<ImportAnalysis> {
  const existing = await db.games.where('folderId').equals(folderId).toArray();
  const fpToExisting = new Map(existing.map((g) => [movesFingerprint(g.pgn), g]));

  const seen = new Set<string>();
  const fresh: ParsedPgnGame[] = [];
  const conflicts: ImportConflict[] = [];
  for (const g of parsed) {
    const fp = movesFingerprint(g.pgn);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    const ex = fpToExisting.get(fp);
    if (ex) conflicts.push({ incoming: g, existingId: ex.id, existingTitle: ex.title });
    else fresh.push(g);
  }
  return { fresh, conflicts };
}

// Adds already-vetted games (no dup check — the caller resolved conflicts).
export async function addParsedGames(folderId: string, games: ParsedPgnGame[]): Promise<number> {
  if (games.length === 0) return 0;
  const now = Date.now();
  const rows = games.map((g) => buildGameRow(folderId, g, now));
  await db.games.bulkAdd(rows);
  await seedConceptsForGames(rows);
  return rows.length;
}

// Overwrites an existing game's moves/headers/annotations with an incoming PGN.
export async function replaceWithParsed(existingId: string, g: ParsedPgnGame): Promise<void> {
  const ann = parseGameAnnotations(g.pgn);
  await db.games.update(existingId, {
    title: g.title,
    pgn: g.pgn,
    headers: g.headers,
    nodeComments: ann?.nodeComments ?? {},
    nodeMeta: ann?.nodeMeta ?? {},
    annotations: ann?.annotations ?? {},
    nags: ann?.nags ?? {},
    updatedAt: Date.now(),
  });
  const updated = await db.games.get(existingId);
  if (updated) await seedConceptsForGame(updated);
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
  // The main line (root first), used to translate session-only node ids into the
  // stable ply keys everything is persisted under.
  mainLine: GameNode[];
  nodeComments: Map<string, NodeAnnotation[]>;
  nodeMeta?: Map<string, NodeMeta>;
  allAnnotations: Map<string, StoredAnnotation>;
  nags?: Map<string, number[]>;
}

// Persisted per-node data is keyed by main-line position, not the ephemeral node
// id, so it round-trips a save → reload regardless of when the tree was built.
// 'root' is the start position; move plies are '0','1',… Variation nodes have no
// ply and are dropped on save (they're not in the exported main-line PGN either).
function buildIdToPly(mainLine: GameNode[]): Map<string, string> {
  const m = new Map<string, string>();
  mainLine.forEach((n, i) => m.set(n.id, i === 0 ? 'root' : String(i - 1)));
  return m;
}

function remapToPly<T>(
  src: Map<string, T> | undefined,
  idToPly: Map<string, string>,
  keep: (v: T) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  src?.forEach((v, id) => {
    const k = idToPly.get(id);
    if (k !== undefined && keep(v)) out[k] = v;
  });
  return out;
}

export function serializeBoardState(
  folderId: string,
  snapshot: BoardStateSnapshot,
  reviewData?: GameReview | null,
): SaveGamePayload {
  const pgn = snapshot.exportPgn();

  const idToPly = buildIdToPly(snapshot.mainLine);
  const nodeComments = remapToPly(snapshot.nodeComments, idToPly, (v) => v.length > 0);
  const nodeMeta = remapToPly(snapshot.nodeMeta, idToPly, () => true);
  const annotations = remapToPly(snapshot.allAnnotations, idToPly, () => true);
  const nags = remapToPly(snapshot.nags, idToPly, (v) => v.length > 0);

  return {
    folderId,
    title: deriveTitle(snapshot.headers),
    pgn,
    headers: { ...snapshot.headers },
    nodeComments,
    nodeMeta,
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
  const { pgn, headers, nodeComments, nodeMeta, annotations, nags } = serializeBoardState('', snapshot);
  const draft: BoardDraft = {
    id: DRAFT_ID,
    pgn,
    headers,
    nodeComments,
    nodeMeta,
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
