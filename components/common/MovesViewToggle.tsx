'use client';
// Shared inline ↔ vertical view toggle for every moves-list component.
// "Inline" is the classic flowing-paragraph scoresheet; "vertical" is the
// game-reviewer-style one-move-pair-per-row list — much easier to read once
// engine evals, glyphs or comments ride along with the moves.

import { useEffect, useState } from 'react';

export type MovesView = 'inline' | 'vertical';

// Persist per surface ("board", "reviewer", …) so each page keeps the
// reading mode the user chose for it.
export function useMovesView(storageKey: string, defaultView: MovesView): [MovesView, (v: MovesView) => void] {
  const [view, setView] = useState<MovesView>(defaultView);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`movesview:${storageKey}`);
      if (stored === 'inline' || stored === 'vertical') setView(stored);
    } catch { /* private mode etc. */ }
  }, [storageKey]);
  const set = (v: MovesView) => {
    setView(v);
    try { localStorage.setItem(`movesview:${storageKey}`, v); } catch { /* ignore */ }
  };
  return [view, set];
}

function InlineIcon() {
  // Flowing text lines
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function VerticalIcon() {
  // Two-column rows
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <rect x="3" y="4" width="8" height="4" rx="1" />
      <rect x="13" y="4" width="8" height="4" rx="1" />
      <rect x="3" y="12" width="8" height="4" rx="1" />
      <rect x="13" y="12" width="8" height="4" rx="1" />
    </svg>
  );
}

export function MovesViewToggle({ view, onChange }: { view: MovesView; onChange: (v: MovesView) => void }) {
  const base = 'grid place-items-center h-5 w-6 transition-colors';
  return (
    <span className="inline-flex rounded border border-zinc-700 overflow-hidden shrink-0" role="group" aria-label="Moves list view">
      <button
        onClick={() => onChange('inline')}
        title="Inline view — flowing scoresheet"
        aria-pressed={view === 'inline'}
        className={`${base} ${view === 'inline' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
      >
        <InlineIcon />
      </button>
      <button
        onClick={() => onChange('vertical')}
        title="Vertical view — one move pair per row (best with evals/annotations)"
        aria-pressed={view === 'vertical'}
        className={`${base} ${view === 'vertical' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
      >
        <VerticalIcon />
      </button>
    </span>
  );
}
