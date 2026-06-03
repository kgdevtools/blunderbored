'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, LibraryFolder, LibraryGame, ConceptNode, GraphEdge } from '@/lib/db';

// Folders whose parentId matches — null means root level.
// We filter in JS rather than via index because IndexedDB does not index null values.
export function useFolderChildren(parentId: string | null): LibraryFolder[] {
  return useLiveQuery(
    () => db.folders
      .toArray()
      .then(all =>
        all
          .filter(f => f.parentId === parentId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    [parentId],
  ) ?? [];
}

// Games in a specific folder, newest first.
export function useFolderGames(folderId: string | null): LibraryGame[] {
  return useLiveQuery(
    () => {
      if (!folderId) return Promise.resolve([] as LibraryGame[]);
      return db.games
        .where('folderId').equals(folderId)
        .toArray()
        .then(games => games.sort((a, b) => b.updatedAt - a.updatedAt));
    },
    [folderId],
  ) ?? [];
}

// All concept nodes, sorted by name (name isn't indexed, so sort in JS).
export function useConcepts(): ConceptNode[] {
  return useLiveQuery(
    () => db.conceptNodes.toArray().then(c => c.sort((a, b) => a.name.localeCompare(b.name))),
    [],
  ) ?? [];
}

// Every game in the library, newest first. Used by the ref-linker / graph.
export function useAllGames(): LibraryGame[] {
  return useLiveQuery(
    () => db.games.toArray().then(g => g.sort((a, b) => b.updatedAt - a.updatedAt)),
    [],
  ) ?? [];
}

// Edges anchored at a specific move of a game (move→game / move→concept refs).
export function useRefsForNode(gameId: string | null, sourceNodeId: string | null): GraphEdge[] {
  return useLiveQuery(
    () => {
      if (!gameId || !sourceNodeId) return Promise.resolve([] as GraphEdge[]);
      return db.graphEdges
        .where('source').equals(gameId)
        .filter(e => e.sourceNodeId === sourceNodeId)
        .toArray();
    },
    [gameId, sourceNodeId],
  ) ?? [];
}

// Breadcrumb chain from root down to folderId: [{ id, name }, ...]
export function useFolderPath(folderId: string | null): Pick<LibraryFolder, 'id' | 'name'>[] {
  return useLiveQuery(
    async () => {
      if (!folderId) return [];
      const path: Pick<LibraryFolder, 'id' | 'name'>[] = [];
      let id: string | null = folderId;
      while (id) {
        const folder: LibraryFolder | undefined = await db.folders.get(id);
        if (!folder) break;
        path.unshift({ id: folder.id, name: folder.name });
        id = folder.parentId;
      }
      return path;
    },
    [folderId],
  ) ?? [];
}
