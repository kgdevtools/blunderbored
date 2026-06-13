import { nanoid } from 'nanoid';
import { db, GraphEdge } from './db';

// ─── Direction conventions ────────────────────────────────────────────────────
//
// concept-concept  : source = parent concept,  target = child concept
// concept-game     : auto tag → source = concept, target = game (no sourceNodeId)
//                    move→concept ref → source = game, target = concept (+ sourceNodeId)
// game-game        : move→game ref → source = origin game, target = dest game (+ sourceNodeId)
// concept-position : tag → source = concept, target = saved position (no sourceNodeId)
//
// `sourceNodeId` is the gameTree move node that anchors a ref, in whichever
// endpoint is a game. Its presence is what distinguishes a ref from a plain tag.

// ─── Concept↔game tagging (auto + manual) ─────────────────────────────────────

// Idempotent: links a concept to a game (concept→game) unless that tag already
// exists. Used by ECO auto-seed (origin 'auto') and the manual tagging picker.
export async function ensureConceptGameEdge(
  conceptId: string,
  gameId: string,
  origin: GraphEdge['origin'] = 'manual',
): Promise<GraphEdge | null> {
  const dupe = await db.graphEdges
    .where('[source+type]').equals([conceptId, 'concept-game'])
    .filter((e) => e.target === gameId && !e.sourceNodeId)
    .first();
  if (dupe) return dupe;

  const edge: GraphEdge = {
    id: nanoid(),
    type: 'concept-game',
    source: conceptId,
    target: gameId,
    origin,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.graphEdges.add(edge);
  return edge;
}

// Idempotent: tag a saved position with a concept (concept→position).
export async function ensureConceptPositionEdge(
  conceptId: string,
  positionId: string,
  origin: GraphEdge['origin'] = 'manual',
): Promise<GraphEdge | null> {
  const dupe = await db.graphEdges
    .where('[source+type]').equals([conceptId, 'concept-position'])
    .filter((e) => e.target === positionId)
    .first();
  if (dupe) return dupe;

  const edge: GraphEdge = {
    id: nanoid(),
    type: 'concept-position',
    source: conceptId,
    target: positionId,
    origin,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.graphEdges.add(edge);
  return edge;
}

// Remove a single concept→position tag.
export async function removeConceptPositionEdge(conceptId: string, positionId: string): Promise<void> {
  const ids = await db.graphEdges
    .where('[source+type]').equals([conceptId, 'concept-position'])
    .filter((e) => e.target === positionId)
    .primaryKeys();
  await db.graphEdges.bulkDelete(ids);
}

// ─── Move-anchored refs (move → game | concept) ───────────────────────────────

export interface SetRefArgs {
  gameId: string;
  sourceNodeId: string;               // the move the ref hangs off
  targetType: 'game' | 'concept';
  targetId: string;
  label?: string;
}

export async function setRef({ gameId, sourceNodeId, targetType, targetId, label }: SetRefArgs): Promise<GraphEdge> {
  const edge: GraphEdge = {
    id: nanoid(),
    type: targetType === 'game' ? 'game-game' : 'concept-game',
    source: gameId,
    target: targetId,
    sourceNodeId,
    origin: 'manual',
    label,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.graphEdges.add(edge);
  return edge;
}

export async function removeRef(edgeId: string): Promise<void> {
  await db.graphEdges.delete(edgeId);
}

// Refs hanging off a specific move of a game.
export async function refsForNode(gameId: string, sourceNodeId: string): Promise<GraphEdge[]> {
  return db.graphEdges
    .where('source').equals(gameId)
    .filter((e) => e.sourceNodeId === sourceNodeId)
    .toArray();
}

// ─── Queries for the graph view ────────────────────────────────────────────────

// Every edge touching a node, regardless of type or direction.
export async function edgesForNode(id: string): Promise<GraphEdge[]> {
  return db.graphEdges.where('source').equals(id).or('target').equals(id).toArray();
}

export interface ConceptLevelGraph {
  concepts: import('./db').ConceptNode[];
  edges: GraphEdge[];                     // concept-concept only
  gameCounts: Record<string, number>;     // conceptId → number of games tagged
  positionCounts: Record<string, number>; // conceptId → number of positions tagged
}

// The default graph view: concepts + concept-concept edges + per-concept game &
// position counts. Items stay collapsed until a concept is expanded.
export async function conceptLevelGraph(): Promise<ConceptLevelGraph> {
  const [concepts, allEdges] = await Promise.all([
    db.conceptNodes.toArray(),
    db.graphEdges.toArray(),
  ]);

  const edges = allEdges.filter((e) => e.type === 'concept-concept');

  const gameCounts: Record<string, number> = {};
  const positionCounts: Record<string, number> = {};
  for (const e of allEdges) {
    if (e.type === 'concept-game' && !e.sourceNodeId) {
      gameCounts[e.source] = (gameCounts[e.source] ?? 0) + 1;
    } else if (e.type === 'concept-position') {
      positionCounts[e.source] = (positionCounts[e.source] ?? 0) + 1;
    }
  }
  return { concepts, edges, gameCounts, positionCounts };
}

export interface EgoNetwork {
  nodeIds: string[];   // ids in the neighbourhood (concepts and/or games)
  edges: GraphEdge[];
}

// Breadth-first neighbourhood around a node, out to `depth` hops.
export async function egoNetwork(id: string, depth = 1): Promise<EgoNetwork> {
  const seen = new Set<string>([id]);
  const collected: GraphEdge[] = [];
  let frontier = [id];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      const edges = await edgesForNode(nodeId);
      for (const e of edges) {
        collected.push(e);
        for (const end of [e.source, e.target]) {
          if (!seen.has(end)) { seen.add(end); next.push(end); }
        }
      }
    }
    frontier = next;
  }
  // Dedupe edges by id (a shared edge can be hit from both endpoints).
  const edges = [...new Map(collected.map((e) => [e.id, e])).values()];
  return { nodeIds: [...seen], edges };
}

// ─── Cleanup / rollback ─────────────────────────────────────────────────────

// Remove every edge that references a game (called when a game is deleted).
export async function deleteEdgesForGame(gameId: string): Promise<void> {
  const ids = await db.graphEdges.where('source').equals(gameId).or('target').equals(gameId).primaryKeys();
  await db.graphEdges.bulkDelete(ids);
}

// Remove every edge that references a saved position (called on position delete).
export async function deleteEdgesForPosition(positionId: string): Promise<void> {
  const ids = await db.graphEdges.where('source').equals(positionId).or('target').equals(positionId).primaryKeys();
  await db.graphEdges.bulkDelete(ids);
}

// Wipe only auto-generated graph data (ECO-seeded concepts + their edges),
// keeping hand-made concepts and refs. The narrow rollback.
export async function purgeAutoGraphData(): Promise<void> {
  await db.transaction('rw', db.conceptNodes, db.graphEdges, async () => {
    await db.graphEdges.where('origin').equals('auto').delete();
    await db.conceptNodes.where('origin').equals('auto').delete();
  });
}

// Full rollback: drop the entire graph layer and strip NAGs, leaving
// games/folders/drafts untouched. Wire to a hidden "Reset graph data" action.
export async function purgeGraphData(): Promise<void> {
  await db.transaction('rw', db.conceptNodes, db.graphEdges, db.games, async () => {
    await db.conceptNodes.clear();
    await db.graphEdges.clear();
    await db.games.toCollection().modify((g) => { delete g.nags; });
  });
}
