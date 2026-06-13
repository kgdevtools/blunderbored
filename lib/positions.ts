'use client';
import { nanoid } from 'nanoid';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SavedPosition, type ConceptNode } from './db';
import { ensureConceptPositionEdge, removeConceptPositionEdge, deleteEdgesForPosition } from './edges';

// CRUD + concept tagging + practice stats for saved positions (practice
// bookmarks). Positions are first-class nodes in the concept graph; tags are
// concept→position edges (see lib/edges.ts).

export async function createSavedPosition(
  input: Omit<SavedPosition, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SavedPosition> {
  const now = Date.now();
  const pos: SavedPosition = { ...input, id: nanoid(), createdAt: now, updatedAt: now };
  await db.savedPositions.add(pos);
  return pos;
}

export async function updateSavedPosition(id: string, patch: Partial<SavedPosition>): Promise<void> {
  await db.savedPositions.update(id, { ...patch, updatedAt: Date.now() });
}

// Removes the position and every edge that references it.
export async function deleteSavedPosition(id: string): Promise<void> {
  await db.transaction('rw', db.savedPositions, db.graphEdges, async () => {
    await deleteEdgesForPosition(id);
    await db.savedPositions.delete(id);
  });
}

// Record a practice attempt's outcome (stats now; SRS scheduling layered later).
export async function recordPractice(id: string, result: 'succeeded' | 'failed'): Promise<void> {
  const pos = await db.savedPositions.get(id);
  if (!pos) return;
  await db.savedPositions.update(id, {
    lastPracticedAt: Date.now(),
    timesPracticed: (pos.timesPracticed ?? 0) + 1,
    lastResult: result,
    updatedAt: Date.now(),
  });
}

// ─── Concept tagging ──────────────────────────────────────────────────────────

export async function tagPositionConcept(positionId: string, conceptId: string): Promise<void> {
  await ensureConceptPositionEdge(conceptId, positionId, 'manual');
}

export async function untagPositionConcept(positionId: string, conceptId: string): Promise<void> {
  await removeConceptPositionEdge(conceptId, positionId);
}

// Concepts currently tagged on a position.
export async function conceptsForPosition(positionId: string): Promise<ConceptNode[]> {
  const edges = await db.graphEdges
    .where('[target+type]').equals([positionId, 'concept-position'])
    .toArray();
  const ids = edges.map((e) => e.source);
  const nodes = await db.conceptNodes.bulkGet(ids);
  return nodes.filter((n): n is ConceptNode => !!n);
}

// Saved positions tagged with a concept.
export async function positionsForConcept(conceptId: string): Promise<SavedPosition[]> {
  const edges = await db.graphEdges
    .where('[source+type]').equals([conceptId, 'concept-position'])
    .toArray();
  const ids = edges.map((e) => e.target);
  const positions = await db.savedPositions.bulkGet(ids);
  return positions.filter((p): p is SavedPosition => !!p);
}

// ─── Live-query hooks ─────────────────────────────────────────────────────────

// All saved positions, newest first.
export function useSavedPositions(limit?: number): SavedPosition[] {
  return useLiveQuery(() => {
    const coll = db.savedPositions.orderBy('updatedAt').reverse();
    return (limit ? coll.limit(limit) : coll).toArray();
  }, [limit]) ?? [];
}

// The concepts tagged on a position, kept live for the editor UI.
export function usePositionConcepts(positionId: string | null): ConceptNode[] {
  return useLiveQuery(
    () => (positionId ? conceptsForPosition(positionId) : Promise.resolve([])),
    [positionId],
  ) ?? [];
}

// Positions filtered by concept (null = all, newest first).
export function usePositionsForConcept(conceptId: string | null): SavedPosition[] {
  return useLiveQuery(
    () => (conceptId ? positionsForConcept(conceptId) : db.savedPositions.orderBy('updatedAt').reverse().toArray()),
    [conceptId],
  ) ?? [];
}
