'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { ConceptNode, LibraryGame } from '@/lib/db';
import { useConcepts } from '@/hooks/useLibrary';
import { createConcept, renameConcept, deleteConcept, colorForFamily } from '@/lib/concepts';

// Stable empty fallbacks so a not-yet-loaded live query doesn't churn useMemo deps.
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_HIERARCHY: [string, string][] = [];

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PawnIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-500 shrink-0">
      <path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.5 11a.5.5 0 0 0-.49.6l1 5A.5.5 0 0 0 9.5 17H11v2H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2h1.5a.5.5 0 0 0 .49-.4l1-5a.5.5 0 0 0-.49-.6h-7z" />
    </svg>
  );
}

// ─── Games tagged to a concept (the dropdown under a concept name) ─────────────

function ConceptGames({ conceptId, onOpenGame }: { conceptId: string; onOpenGame?: (g: LibraryGame) => void }) {
  const games = useLiveQuery(async () => {
    const edges = await db.graphEdges.where('[source+type]').equals([conceptId, 'concept-game']).toArray();
    const ids = edges.filter((e) => !e.sourceNodeId).map((e) => e.target);
    if (ids.length === 0) return [];
    const gs = await db.games.bulkGet(ids);
    return gs.filter((g): g is LibraryGame => !!g);
  }, [conceptId]);

  if (games === undefined) return <div className="pl-9 py-1 text-[11px] text-zinc-600">Loading…</div>;
  if (games.length === 0) return <div className="pl-9 py-1 text-[11px] italic text-zinc-600">No games tagged</div>;

  return (
    <div className="pl-9 pr-2 pb-1 flex flex-col border-l border-zinc-800/70 ml-3">
      {games.map((g) => (
        <button
          key={g.id}
          onClick={() => onOpenGame?.(g)}
          disabled={!onOpenGame}
          className="flex items-center gap-1.5 py-1 text-left text-[11px] text-zinc-400 enabled:hover:text-zinc-100 disabled:cursor-default min-w-0 transition-colors"
          title={onOpenGame ? `Open “${g.title}”` : g.title}
        >
          <PawnIcon />
          <span className="truncate">{g.title}</span>
          {g.headers.Result && g.headers.Result !== '*' && (
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-600">{g.headers.Result}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── A single concept row (clicking the name opens its games) ──────────────────

function ConceptRow({
  concept,
  count,
  indent,
  lead,
  stats,
  isEditing,
  onEditStart,
  onEditDone,
  onOpenGame,
}: {
  concept: ConceptNode;
  count: number;
  indent?: boolean;
  lead?: React.ReactNode;          // hub collapse chevron, or a spacer for alignment
  stats?: React.ReactNode;         // trailing aggregate stats (hubs)
  isEditing: boolean;
  onEditStart: () => void;
  onEditDone: () => void;
  onOpenGame?: (g: LibraryGame) => void;
}) {
  const [gamesOpen, setGamesOpen] = useState(false);

  return (
    <>
      <div className={`group flex items-center gap-2 py-1.5 pr-1 rounded hover:bg-zinc-800/60 ${indent ? 'pl-6' : 'pl-2'}`}>
        {lead ?? <span className="w-2.5 shrink-0" />}

        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorForFamily(concept.family) }} title={`Family ${concept.family}`} />

        {isEditing ? (
          <input
            autoFocus
            defaultValue={concept.name}
            onBlur={(e) => { renameConcept(concept.id, e.target.value); onEditDone(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { renameConcept(concept.id, (e.target as HTMLInputElement).value); onEditDone(); }
              if (e.key === 'Escape') onEditDone();
            }}
            className="flex-1 min-w-0 text-sm px-1.5 py-0.5 rounded bg-zinc-700 border border-blue-500 text-zinc-100 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setGamesOpen((v) => !v)}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm text-zinc-200"
            title="Show tagged games"
          >
            <span className="truncate">{concept.name}</span>
            <span className="shrink-0 text-zinc-600"><Chevron open={gamesOpen} /></span>
          </button>
        )}

        {concept.eco && <span className="text-[10px] font-mono text-zinc-500 shrink-0">{concept.eco}</span>}

        {stats ?? (
          <span className="text-[11px] tabular-nums text-zinc-400 w-7 text-right shrink-0" title={`${count} games`}>{count}</span>
        )}

        {!isEditing && (
          <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={onEditStart}
              className="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
              title="Rename concept" aria-label="Rename concept"
            ><PencilIcon /></button>
            <button
              onClick={() => { if (confirm(`Delete concept “${concept.name}”? This removes its links too.`)) deleteConcept(concept.id); }}
              className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-900/40 transition-colors"
              title="Delete concept" aria-label="Delete concept"
            ><TrashIcon /></button>
          </div>
        )}
      </div>

      {gamesOpen && <ConceptGames conceptId={concept.id} onOpenGame={onOpenGame} />}
    </>
  );
}

// ─── ConceptList ───────────────────────────────────────────────────────────────

export function ConceptList({ onOpenGame }: { onOpenGame?: (game: LibraryGame) => void }) {
  const concepts = useConcepts();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsedHubs, setCollapsedHubs] = useState<Set<string>>(new Set());

  // game-count per concept = number of concept→game tag edges (not refs)
  const counts = useLiveQuery(async () => {
    const edges = await db.graphEdges.where('type').equals('concept-game').toArray();
    const m: Record<string, number> = {};
    for (const e of edges) if (!e.sourceNodeId) m[e.source] = (m[e.source] ?? 0) + 1;
    return m;
  }, []) ?? EMPTY_COUNTS;

  // parent→child relationships drive the grouping (same hierarchy the graph uses)
  const hierarchy = useLiveQuery(async () => {
    const edges = await db.graphEdges.where('type').equals('concept-concept').toArray();
    return edges.map((e) => [e.source, e.target] as [string, string]);
  }, []) ?? EMPTY_HIERARCHY;

  const { groups, standalone } = useMemo(() => {
    const byId = new Map(concepts.map((c) => [c.id, c]));
    const childIds = new Set<string>();
    const childrenByParent = new Map<string, string[]>();
    for (const [parent, child] of hierarchy) {
      if (!byId.has(parent) || !byId.has(child)) continue;
      childIds.add(child);
      const arr = childrenByParent.get(parent) ?? [];
      arr.push(child);
      childrenByParent.set(parent, arr);
    }

    const byGamesThenName = (a: ConceptNode, b: ConceptNode) =>
      (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name);

    const hubIds = [...childrenByParent.keys()].filter((id) => byId.has(id));
    const groups = hubIds
      .map((id) => {
        const hub = byId.get(id)!;
        const children = (childrenByParent.get(id) ?? [])
          .map((cid) => byId.get(cid)!).filter(Boolean).sort(byGamesThenName);
        const total = (counts[id] ?? 0) + children.reduce((s, c) => s + (counts[c.id] ?? 0), 0);
        return { hub, children, total };
      })
      .sort((a, b) => b.total - a.total || a.hub.name.localeCompare(b.hub.name));

    const hubSet = new Set(hubIds);
    const standalone = concepts
      .filter((c) => !childIds.has(c.id) && !hubSet.has(c.id))
      .sort(byGamesThenName);

    return { groups, standalone };
  }, [concepts, hierarchy, counts]);

  const toggleHub = (id: string) =>
    setCollapsedHubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs text-zinc-500">{concepts.length} concept{concepts.length === 1 ? '' : 's'}</span>
        <button
          onClick={() => createConcept('New Concept').then((c) => setEditingId(c.id))}
          className="inline-flex items-center gap-1 rounded bg-zinc-700 hover:bg-zinc-600 px-2 py-1 text-[11px] font-medium text-zinc-200"
        >
          <PlusIcon /> New concept
        </button>
      </div>

      {concepts.length === 0 ? (
        <p className="text-xs text-zinc-600 px-1 py-3">
          No concepts yet. Opening concepts appear automatically when you save games with ECO tags.
        </p>
      ) : (
        <div className="flex flex-col">
          {/* Parent groups */}
          {groups.map(({ hub, children, total }) => {
            const collapsed = collapsedHubs.has(hub.id);
            return (
              <div key={hub.id}>
                <ConceptRow
                  concept={hub}
                  count={counts[hub.id] ?? 0}
                  isEditing={editingId === hub.id}
                  onEditStart={() => setEditingId(hub.id)}
                  onEditDone={() => setEditingId(null)}
                  onOpenGame={onOpenGame}
                  lead={
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleHub(hub.id); }}
                      className="w-2.5 shrink-0 flex items-center justify-center text-zinc-500 hover:text-zinc-200"
                      title={collapsed ? 'Expand variations' : 'Collapse variations'}
                      aria-label={collapsed ? 'Expand variations' : 'Collapse variations'}
                    >
                      <Chevron open={!collapsed} />
                    </button>
                  }
                  stats={
                    <span
                      className="flex items-center gap-1 shrink-0 text-[10px] tabular-nums text-zinc-500"
                      title={`${children.length} variation${children.length === 1 ? '' : 's'} · ${total} game${total === 1 ? '' : 's'}`}
                    >
                      <span className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">{children.length} lines</span>
                      <span className="w-7 text-right text-zinc-400">{total}</span>
                    </span>
                  }
                />
                {!collapsed && children.map((child) => (
                  <ConceptRow
                    key={child.id}
                    concept={child}
                    count={counts[child.id] ?? 0}
                    indent
                    isEditing={editingId === child.id}
                    onEditStart={() => setEditingId(child.id)}
                    onEditDone={() => setEditingId(null)}
                    onOpenGame={onOpenGame}
                  />
                ))}
              </div>
            );
          })}

          {/* Ungrouped concepts */}
          {standalone.length > 0 && (
            <>
              {groups.length > 0 && (
                <div className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Other</div>
              )}
              {standalone.map((c) => (
                <ConceptRow
                  key={c.id}
                  concept={c}
                  count={counts[c.id] ?? 0}
                  isEditing={editingId === c.id}
                  onEditStart={() => setEditingId(c.id)}
                  onEditDone={() => setEditingId(null)}
                  onOpenGame={onOpenGame}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
