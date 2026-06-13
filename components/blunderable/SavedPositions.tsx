'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SavedPosition, type ConceptNode } from '@/lib/db';
import { createConcept, colorForFamily } from '@/lib/concepts';
import { createSavedPosition, deleteSavedPosition, tagPositionConcept, untagPositionConcept, usePositionConcepts, useSavedPositions } from '@/lib/positions';

// All concepts, live (for the tag picker). NOTE: `name` is not an indexed field
// on conceptNodes, so we fetch all and sort in JS (orderBy('name') would throw).
function useAllConcepts(): ConceptNode[] {
  return useLiveQuery(async () => {
    const all = await db.conceptNodes.toArray();
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, []) ?? [];
}

function ConceptChip({ c, onRemove }: { c: ConceptNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[11px]" style={{ background: `${colorForFamily(c.family)}22`, color: colorForFamily(c.family) }}>
      {c.name}
      {onRemove && <button onClick={onRemove} className="hover:text-zinc-100" aria-label="Remove tag">×</button>}
    </span>
  );
}

// Live tag editor bound to a saved position: removable chips + an add box that
// picks an existing concept or creates a new one. Used in the positions manager.
export function ConceptTagEditor({ positionId }: { positionId: string }) {
  const tagged = usePositionConcepts(positionId);
  const allConcepts = useAllConcepts();
  const [query, setQuery] = useState('');
  const taggedIds = new Set(tagged.map((c) => c.id));
  const q = query.trim().toLowerCase();
  const matches = allConcepts.filter((c) => !taggedIds.has(c.id) && (!q || c.name.toLowerCase().includes(q))).slice(0, 6);
  const exactExists = allConcepts.some((c) => c.name.trim().toLowerCase() === q);

  const addNew = async () => {
    const name = query.trim();
    if (!name) return;
    const c = await createConcept(name);
    await tagPositionConcept(positionId, c.id);
    setQuery('');
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {tagged.map((c) => <ConceptChip key={c.id} c={c} onRemove={() => untagPositionConcept(positionId, c.id)} />)}
        {tagged.length === 0 && <span className="text-[11px] text-zinc-600">No concepts yet</span>}
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tag a concept…"
        className="w-full px-2 py-1 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] focus:outline-none focus:border-zinc-500" />
      {(matches.length > 0 || (q && !exactExists)) && (
        <div className="flex flex-wrap gap-1">
          {matches.map((c) => (
            <button key={c.id} onClick={() => { tagPositionConcept(positionId, c.id); setQuery(''); }} className="px-1.5 py-0.5 rounded-sm text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300">{c.name}</button>
          ))}
          {q && !exactExists && (
            <button onClick={addNew} className="px-1.5 py-0.5 rounded-sm text-[11px] bg-indigo-700 hover:bg-indigo-600 text-white">+ “{query.trim()}”</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Save dialog ──────────────────────────────────────────────────────────────

export interface SavePositionInput {
  fen: string;
  side: 'w' | 'b';
  ratingElo?: number;
  target?: number;
  clockInitialMs?: number;
  clockIncMs?: number;
  source?: SavedPosition['source'];
}

export function SavePositionDialog({ input, onClose }: { input: SavePositionInput; onClose: () => void }) {
  const allConcepts = useAllConcepts();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ConceptNode[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const selectedIds = new Set(selected.map((c) => c.id));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allConcepts.filter((c) => !selectedIds.has(c.id) && (!q || c.name.toLowerCase().includes(q))).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allConcepts, query, selected]);
  const exactExists = allConcepts.some((c) => c.name.trim().toLowerCase() === query.trim().toLowerCase());

  const addExisting = (c: ConceptNode) => { setSelected((s) => [...s, c]); setQuery(''); };
  const addNew = async () => {
    const name = query.trim();
    if (!name) return;
    const c = await createConcept(name);
    setSelected((s) => [...s, c]); setQuery('');
  };

  const save = async () => {
    setSaving(true);
    const pos = await createSavedPosition({
      fen: input.fen, side: input.side, title: title.trim() || 'Untitled position', note: note.trim() || undefined,
      ratingElo: input.ratingElo, target: input.target, clockInitialMs: input.clockInitialMs, clockIncMs: input.clockIncMs,
      source: input.source ?? 'blunderable',
    });
    for (const c of selected) await tagPositionConcept(pos.id, c.id);
    setSaving(false); setDone(true);
    setTimeout(onClose, 650);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-md shadow-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-100">Save position</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 text-lg leading-none" aria-label="Close">×</button>
        </div>

        {done ? (
          <p className="text-sm text-emerald-400 py-4 text-center">Saved ✓</p>
        ) : (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. IQP — White to hold)" autoFocus
              className="w-full px-2 py-1.5 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm focus:outline-none focus:border-zinc-500" />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" rows={2}
              className="w-full px-2 py-1.5 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs resize-none focus:outline-none focus:border-zinc-500" />

            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Concepts</div>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {selected.map((c) => <ConceptChip key={c.id} c={c} onRemove={() => setSelected((s) => s.filter((x) => x.id !== c.id))} />)}
                </div>
              )}
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tag a concept…"
                className="w-full px-2 py-1.5 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500" />
              {(matches.length > 0 || (query.trim() && !exactExists)) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {matches.map((c) => (
                    <button key={c.id} onClick={() => addExisting(c)} className="px-1.5 py-0.5 rounded-sm text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300">{c.name}</button>
                  ))}
                  {query.trim() && !exactExists && (
                    <button onClick={addNew} className="px-1.5 py-0.5 rounded-sm text-[11px] bg-indigo-700 hover:bg-indigo-600 text-white">+ “{query.trim()}”</button>
                  )}
                </div>
              )}
            </div>

            <button onClick={save} disabled={saving} className="w-full py-2 rounded-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold">
              {saving ? 'Saving…' : 'Save position'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Saved-positions list (setup screen) ──────────────────────────────────────

function fmtClockShort(ms?: number): string {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  return `${m}m`;
}

function PositionRow({ pos, onLoad }: { pos: SavedPosition; onLoad: (p: SavedPosition) => void }) {
  const concepts = usePositionConcepts(pos.id);
  return (
    <div className="flex items-center gap-2 text-xs py-1 border-b border-zinc-800/50 last:border-0">
      <button onClick={() => onLoad(pos)} className="flex-1 min-w-0 text-left group">
        <div className="flex items-center gap-2">
          <span className="text-zinc-200 truncate group-hover:text-white">{pos.title}</span>
          <span className="text-[10px] text-zinc-600 shrink-0">{pos.side === 'w' ? 'W' : 'B'}{pos.ratingElo ? ` · ${pos.ratingElo}` : ''}{pos.clockInitialMs ? ` · ${fmtClockShort(pos.clockInitialMs)}` : ''}</span>
        </div>
        {(concepts.length > 0 || pos.timesPracticed) && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {concepts.slice(0, 3).map((c) => <ConceptChip key={c.id} c={c} />)}
            {pos.timesPracticed ? <span className="text-[10px] text-zinc-600">{pos.timesPracticed}× · {pos.lastResult === 'succeeded' ? 'held' : 'failed'}</span> : null}
          </div>
        )}
      </button>
      <button onClick={() => { if (confirm(`Delete “${pos.title}”?`)) deleteSavedPosition(pos.id); }} className="text-zinc-600 hover:text-red-400 shrink-0 px-1" aria-label="Delete">×</button>
    </div>
  );
}

export function SavedPositionsList({ onLoad }: { onLoad: (p: SavedPosition) => void }) {
  const positions = useSavedPositions(20);
  if (positions.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Saved positions</div>
      <div>{positions.map((p) => <PositionRow key={p.id} pos={p} onLoad={onLoad} />)}</div>
    </div>
  );
}
