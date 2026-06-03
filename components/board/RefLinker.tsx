'use client';
import { useEffect, useMemo, useState } from 'react';
import { useConcepts, useAllGames, useRefsForNode } from '@/hooks/useLibrary';
import { setRef, removeRef } from '@/lib/edges';
import { colorForFamily } from '@/lib/concepts';

interface RefLinkerProps {
  gameId: string;          // the saved library game the move belongs to
  sourceNodeId: string;    // the move node the ref hangs off
  moveLabel: string;       // e.g. "12. Nf3" — shown in the header for context
  onClose: () => void;
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function RefLinker({ gameId, sourceNodeId, moveLabel, onClose }: RefLinkerProps) {
  const [tab, setTab] = useState<'game' | 'concept'>('concept');
  const [query, setQuery] = useState('');

  const concepts = useConcepts();
  const games = useAllGames();
  const refs = useRefsForNode(gameId, sourceNodeId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lookups so existing refs can show their target's name.
  const conceptName = useMemo(() => new Map(concepts.map(c => [c.id, c])), [concepts]);
  const gameName = useMemo(() => new Map(games.map(g => [g.id, g.title])), [games]);

  const q = query.trim().toLowerCase();
  const filteredConcepts = q ? concepts.filter(c => c.name.toLowerCase().includes(q)) : concepts;
  // A game can't reference itself.
  const filteredGames = (q ? games.filter(g => g.title.toLowerCase().includes(q)) : games)
    .filter(g => g.id !== gameId);

  const handleAdd = (targetType: 'game' | 'concept', targetId: string) => {
    setRef({ gameId, sourceNodeId, targetType, targetId }).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden" style={{ height: 'min(520px, 85vh)' }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/80 shrink-0">
          <span className="text-xs font-semibold text-zinc-200">Link from</span>
          <span className="text-xs font-mono text-blue-300 truncate flex-1">{moveLabel}</span>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700" aria-label="Close">
            <XIcon />
          </button>
        </div>

        {/* Existing refs */}
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-zinc-800 shrink-0">
            {refs.map((r) => {
              const isConcept = r.type === 'concept-game';
              const name = isConcept ? conceptName.get(r.target)?.name : gameName.get(r.target);
              return (
                <span key={r.id} className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300">
                  <span className="text-zinc-500">{isConcept ? '◆' : '○'}</span>
                  <span className="truncate max-w-[160px]">{name ?? '(deleted)'}</span>
                  <button onClick={() => removeRef(r.id).catch(() => {})} className="text-zinc-500 hover:text-red-400" aria-label="Remove link">
                    <XIcon />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-2 shrink-0">
          {(['concept', 'game'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                tab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800',
              ].join(' ')}
            >
              {t === 'concept' ? 'Concepts' : 'Games'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-2 shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab === 'concept' ? 'concepts' : 'games'}…`}
            className="w-full text-xs px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {tab === 'concept' ? (
            filteredConcepts.length === 0
              ? <p className="text-xs text-zinc-600 px-2 py-3">No concepts.</p>
              : filteredConcepts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleAdd('concept', c.id)}
                    className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-zinc-200"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorForFamily(c.family) }} />
                    <span className="truncate">{c.name}</span>
                    {c.eco && <span className="ml-auto text-[10px] font-mono text-zinc-500">{c.eco}</span>}
                  </button>
                ))
          ) : (
            filteredGames.length === 0
              ? <p className="text-xs text-zinc-600 px-2 py-3">No other games.</p>
              : filteredGames.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleAdd('game', g.id)}
                    className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 text-sm text-zinc-200"
                  >
                    <span className="text-zinc-600">○</span>
                    <span className="truncate">{g.title}</span>
                  </button>
                ))
          )}
        </div>
      </div>
    </div>
  );
}
