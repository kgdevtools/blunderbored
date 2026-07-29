'use client';
// Tabbed/breadcrumbed modal that appears after "Confirm": one tab per drafted
// puzzle, each editable (title/note/trim) via PuzzleEditForm, ending in
// "Save to Workouts". Nothing here touches the database until Save — the
// puzzles passed in are plain in-memory drafts from lib/puzzleSolution.ts's
// buildDraftPuzzle.

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { Puzzle } from '@/lib/db';
import { solutionLine } from '@/lib/puzzleSolution';
import { PuzzleEditForm } from './PuzzleEditForm';

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface DraftEdit {
  title: string;
  note: string;
  cutAt: number;
}

function initialEdit(p: Puzzle): DraftEdit {
  return { title: p.title ?? '', note: p.note ?? '', cutAt: solutionLine(p).length };
}

interface PuzzleBatchModalProps {
  puzzles: Puzzle[];
  onPreview: (fen: string, lastMove: { from: string; to: string } | null) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onSave: (name: string, finalPuzzles: Puzzle[]) => Promise<void>;
}

export function PuzzleBatchModal({ puzzles, onPreview, onRemove, onClose, onSave }: PuzzleBatchModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [edits, setEdits] = useState<Map<string, DraftEdit>>(
    () => new Map(puzzles.map((p) => [p.id, initialEdit(p)])),
  );
  const [savingName, setSavingName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (!dialogRef.current?.contains(e.target as Node)) onClose();
  };

  const setEdit = useCallback((id: string, patch: Partial<DraftEdit>) => {
    setEdits((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }, []);

  const handleRemove = (id: string) => {
    setEdits((prev) => { const next = new Map(prev); next.delete(id); return next; });
    onRemove(id);
  };

  const clampedIndex = Math.max(0, Math.min(activeIndex, puzzles.length - 1));
  const active = puzzles[clampedIndex];
  const activeEdit = active ? edits.get(active.id) : undefined;

  const finalPuzzles = useMemo(() => puzzles.map((p) => {
    const e = edits.get(p.id);
    if (!e) return p;
    const line = solutionLine(p).slice(0, Math.max(1, e.cutAt));
    return {
      ...p,
      title: e.title.trim() || undefined,
      note: e.note.trim() || undefined,
      solutionLineUci: line,
      solutionUci: line[0] ?? p.solutionUci,
    };
  }), [puzzles, edits]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(savingName, finalPuzzles);
    } finally {
      setSaving(false);
    }
  };

  if (puzzles.length === 0 || !active || !activeEdit) return null;

  const navBtn = 'flex-1 py-1.5 rounded text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        className="bg-zinc-800 rounded-lg w-full max-w-lg max-h-[92vh] overflow-hidden shadow-2xl border border-zinc-700 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-100">Edit puzzles ({puzzles.length})</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors p-0.5 rounded">
            <CloseIcon />
          </button>
        </div>

        {/* Tabs / breadcrumb */}
        <div className="flex gap-1 px-4 py-2 overflow-x-auto border-b border-zinc-700 shrink-0">
          {puzzles.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setActiveIndex(i)}
              title={edits.get(p.id)?.title || `Puzzle ${i + 1}`}
              className={`shrink-0 w-7 h-7 rounded-full text-xs font-semibold transition-colors ${
                i === clampedIndex ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-y-auto min-h-0">
          <PuzzleEditForm
            puzzle={active}
            title={activeEdit.title}
            note={activeEdit.note}
            cutAt={activeEdit.cutAt}
            onTitleChange={(v) => setEdit(active.id, { title: v })}
            onNoteChange={(v) => setEdit(active.id, { note: v })}
            onCutAt={(i) => setEdit(active.id, { cutAt: i })}
            onPreview={onPreview}
          />
          <button
            onClick={() => handleRemove(active.id)}
            className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove this puzzle from the set
          </button>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-700 shrink-0 space-y-2">
          <div className="flex gap-1.5">
            <button className={navBtn} onClick={() => setActiveIndex((i) => Math.max(0, i - 1))} disabled={clampedIndex === 0}>
              ⟨ Prev
            </button>
            <button className={navBtn} onClick={() => setActiveIndex((i) => Math.min(puzzles.length - 1, i + 1))} disabled={clampedIndex >= puzzles.length - 1}>
              Next ⟩
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5">
            <input
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              placeholder={`Workout — ${new Date().toLocaleDateString()}`}
              className="flex-1 bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold whitespace-nowrap"
            >
              {saving ? 'Saving…' : 'Save to Workouts'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
