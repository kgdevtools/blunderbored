import { nanoid } from 'nanoid';
import { db, ConceptNode } from './db';

// ─── Family / colour ────────────────────────────────────────────────────────

// ECO codes group into five volumes A–E; we use the leading letter as the
// "family" for opening concepts. Hand-authored concepts get their own families.
export function familyForEco(eco: string | undefined): string {
  const letter = (eco ?? '').trim().charAt(0).toUpperCase();
  return 'ABCDE'.includes(letter) ? letter : 'other';
}

// Stable colour per family, used by the graph renderer and the concepts table.
const FAMILY_COLORS: Record<string, string> = {
  A: '#f59e0b', // amber — Flank openings
  B: '#ef4444', // red   — Semi-Open
  C: '#3b82f6', // blue  — Open games
  D: '#22c55e', // green — Closed / Queen's pawn
  E: '#a855f7', // purple — Indian defences
  other: '#71717a', // zinc — anything else / themes
};

export function colorForFamily(family: string): string {
  return FAMILY_COLORS[family] ?? FAMILY_COLORS.other;
}

// ─── Concept CRUD ─────────────────────────────────────────────────────────────

export async function createConcept(
  name: string,
  kind: ConceptNode['kind'] = 'custom',
  family?: string,
): Promise<ConceptNode> {
  const concept: ConceptNode = {
    id: nanoid(),
    name: name.trim() || 'New Concept',
    family: family ?? (kind === 'opening' ? 'other' : 'custom'),
    kind,
    origin: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.conceptNodes.add(concept);
  return concept;
}

export async function renameConcept(id: string, name: string): Promise<void> {
  await db.conceptNodes.update(id, { name: name.trim() || 'New Concept', updatedAt: Date.now() });
}

// Removes the concept and any edges that reference it (either endpoint).
export async function deleteConcept(id: string): Promise<void> {
  await db.transaction('rw', db.conceptNodes, db.graphEdges, async () => {
    const edges = await db.graphEdges
      .where('source').equals(id)
      .or('target').equals(id)
      .primaryKeys();
    await db.graphEdges.bulkDelete(edges);
    await db.conceptNodes.delete(id);
  });
}

// Idempotent find-or-create for an opening concept, keyed on its ECO code.
// Returns the existing concept if one already carries that ECO. Auto origin.
export async function ensureOpeningConcept(
  eco: string | undefined,
  opening: string | undefined,
): Promise<ConceptNode | null> {
  const code = (eco ?? '').trim();
  if (!code) return null;

  const existing = await db.conceptNodes.where('eco').equals(code).first();
  if (existing) return existing;

  const concept: ConceptNode = {
    id: nanoid(),
    name: (opening ?? '').trim() || code,
    family: familyForEco(code),
    kind: 'opening',
    eco: code,
    origin: 'auto',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.conceptNodes.add(concept);
  return concept;
}
