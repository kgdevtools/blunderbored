'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useConcepts } from '@/hooks/useLibrary';
import { createConcept, renameConcept, deleteConcept, colorForFamily } from '@/lib/concepts';

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function ConceptList() {
  const concepts = useConcepts();
  const [editingId, setEditingId] = useState<string | null>(null);

  // game-count per concept = number of concept→game tag edges (not refs)
  const counts = useLiveQuery(async () => {
    const edges = await db.graphEdges.where('type').equals('concept-game').toArray();
    const m: Record<string, number> = {};
    for (const e of edges) if (!e.sourceNodeId) m[e.source] = (m[e.source] ?? 0) + 1;
    return m;
  }, []) ?? {};

  const sorted = useMemo(
    () => [...concepts].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name)),
    [concepts, counts],
  );

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

      {sorted.length === 0 ? (
        <p className="text-xs text-zinc-600 px-1 py-3">
          No concepts yet. Opening concepts appear automatically when you save games with ECO tags.
        </p>
      ) : (
        <div className="flex flex-col">
          {sorted.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/60 group">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorForFamily(c.family) }} title={`Family ${c.family}`} />

              {editingId === c.id ? (
                <input
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  defaultValue={c.name}
                  onBlur={(e) => { renameConcept(c.id, e.target.value); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { renameConcept(c.id, (e.target as HTMLInputElement).value); setEditingId(null); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 text-sm px-1.5 py-0.5 rounded bg-zinc-700 border border-blue-500 text-zinc-100 focus:outline-none"
                />
              ) : (
                <button onClick={() => setEditingId(c.id)} className="flex-1 text-left text-sm text-zinc-200 truncate" title="Click to rename">
                  {c.name}
                </button>
              )}

              <span className="text-[10px] uppercase tracking-wide text-zinc-600 shrink-0">{c.kind}</span>
              {c.eco && <span className="text-[10px] font-mono text-zinc-500 shrink-0">{c.eco}</span>}
              <span className="text-[11px] tabular-nums text-zinc-400 w-8 text-right shrink-0">{counts[c.id] ?? 0}</span>

              <button
                onClick={() => { if (confirm(`Delete concept "${c.name}"? This removes its links too.`)) deleteConcept(c.id); }}
                className="p-1 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                aria-label="Delete concept"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
