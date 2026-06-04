import { nanoid } from 'nanoid';
import { db, ConceptNode, GraphEdge } from './db';

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

// ─── Opening hierarchy (concept→concept) ──────────────────────────────────────

// The parent "family" name carried by an opening variation:
//   "Sicilian Defense: Najdorf, English Attack" → "Sicilian Defense"
// Returns null when the name has no variation suffix (it's already a base).
export function baseOpeningName(name: string): string | null {
  const i = name.indexOf(':');
  if (i <= 0) return null;
  return name.slice(0, i).trim() || null;
}

// Derive parent/child concept-concept edges from opening-name structure: a
// "Sicilian Defense" hub linked to every "Sicilian Defense: …" variation. This
// is what gives the overview its clusters (concepts otherwise have no edges).
//
// Idempotent and re-runnable — only ever adds missing hubs/edges. A hub reuses
// an existing concept of the exact base name; otherwise a lightweight synthetic
// one is created, but only when ≥2 variations share the base (no lone hubs).
// Hubs and edges are origin 'auto', so purgeAutoGraphData() rolls them back.
export async function ensureOpeningHierarchy(): Promise<void> {
  const openings = await db.conceptNodes.where('kind').equals('opening').toArray();

  // Group variation concepts (those with a base) by that base name.
  const variationsByBase = new Map<string, ConceptNode[]>();
  for (const c of openings) {
    const base = baseOpeningName(c.name);
    if (!base) continue;
    const list = variationsByBase.get(base);
    if (list) list.push(c);
    else variationsByBase.set(base, [c]);
  }
  if (variationsByBase.size === 0) return;

  // Concepts usable as a ready-made hub, keyed by exact name.
  const byExactName = new Map<string, ConceptNode>();
  for (const c of openings) byExactName.set(c.name.trim(), c);

  // Existing concept-concept edges, for de-dup ("source>target").
  const existingCC = new Set<string>();
  for (const e of await db.graphEdges.where('type').equals('concept-concept').toArray()) {
    existingCC.add(`${e.source}>${e.target}`);
  }

  const newHubs: ConceptNode[] = [];
  const newEdges: GraphEdge[] = [];
  const now = Date.now();

  for (const [base, variations] of variationsByBase) {
    let hub = byExactName.get(base);
    if (!hub) {
      if (variations.length < 2) continue; // not worth a synthetic hub for one
      hub = {
        id: nanoid(),
        name: base,
        family: variations[0].family,
        kind: 'opening',
        origin: 'auto',
        createdAt: now,
        updatedAt: now,
      };
      newHubs.push(hub);
      byExactName.set(base, hub);
    }
    for (const v of variations) {
      if (v.id === hub.id) continue;
      const key = `${hub.id}>${v.id}`;
      if (existingCC.has(key)) continue;
      existingCC.add(key);
      newEdges.push({
        id: nanoid(),
        type: 'concept-concept',
        source: hub.id, // parent
        target: v.id,   // child
        origin: 'auto',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (newHubs.length) await db.conceptNodes.bulkAdd(newHubs);
  if (newEdges.length) await db.graphEdges.bulkAdd(newEdges);
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
