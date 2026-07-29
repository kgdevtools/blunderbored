'use client';
// Edit tab (formerly "Settings") — edits the INDIVIDUAL puzzle currently
// authored/selected: starting position (FEN, or import a whole game/Lichess
// puzzle), description, themes, the solution (two-way synced with the
// board/Moves tab), Save. Time allocation is a set-level setting now (see
// WorkoutsTab), not per-puzzle. "+ New" (Puzzle Set tab) always lands here,
// so importing lives in this tab rather than a separate toolbar button.

import { useRef, useState } from 'react';
import { LichessImportModal, type ImportedLichessPuzzle } from './LichessImportModal';

interface PuzzleEditTabProps {
  setName: string;
  fen: string;
  onApplyFen: (fen: string) => void;
  onImportPgn: (pgn: string) => void;
  onImportLichess: (puzzles: ImportedLichessPuzzle[]) => void;
  note: string;
  onNoteChange: (v: string) => void;
  themes: string[];
  onThemesChange: (themes: string[]) => void;
  solutionText: string;
  onApplySolutionText: (text: string) => void;
  onSave: () => void;
  isEditing: boolean;
  canSave: boolean;
  error?: string | null;
}

const inputCls =
  'w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';

export function PuzzleEditTab({
  setName, fen, onApplyFen, onImportPgn, onImportLichess,
  note, onNoteChange, themes, onThemesChange,
  solutionText, onApplySolutionText,
  onSave, isEditing, canSave, error,
}: PuzzleEditTabProps) {
  const [localFen, setLocalFen] = useState(fen);
  const [seenFen, setSeenFen] = useState(fen);
  if (fen !== seenFen) { setSeenFen(fen); setLocalFen(fen); }

  const [localSolution, setLocalSolution] = useState(solutionText);
  // Board-driven changes (moves played, not typed here) resync the textarea —
  // adjusted during render rather than an effect, same idiom used elsewhere
  // in this codebase for "reset state when a prop changes".
  const [seenSolutionText, setSeenSolutionText] = useState(solutionText);
  if (solutionText !== seenSolutionText) {
    setSeenSolutionText(solutionText);
    setLocalSolution(solutionText);
  }

  const [themeInput, setThemeInput] = useState('');
  const addTheme = () => {
    const t = themeInput.trim();
    if (t && !themes.includes(t)) onThemesChange([...themes, t]);
    setThemeInput('');
  };

  const [showImportRow, setShowImportRow] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [showLichessModal, setShowLichessModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitPgn = () => {
    const text = pgnText.trim();
    if (!text) return;
    onImportPgn(text);
    setPgnText('');
    setShowImportRow(false);
  };
  const handleFileChosen = (file: File) => {
    file.text().then((text) => { onImportPgn(text); setShowImportRow(false); });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* This tab is scoped to ONE puzzle — the set it lives in is just
          light context, not something this tab edits. */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-zinc-800">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Editing this puzzle</p>
          <p className="text-sm font-semibold text-zinc-100 truncate">{isEditing ? (note || 'Untitled puzzle') : 'New puzzle draft'}</p>
        </div>
        <span className="shrink-0 text-[10px] text-zinc-500 text-right pt-0.5">in {setName || 'a new set'}</span>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded px-2.5 py-1.5">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Starting position (FEN)</label>
          <button
            onClick={() => setShowImportRow((v) => !v)}
            className={`text-[10px] px-1.5 py-0.5 rounded ${showImportRow ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            or import a game ▾
          </button>
        </div>
        <input
          value={localFen}
          onChange={(e) => setLocalFen(e.target.value)}
          onBlur={() => onApplyFen(localFen)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApplyFen(localFen); (e.target as HTMLInputElement).blur(); } }}
          placeholder="e.g. rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
          className={`${inputCls} font-mono text-xs`}
        />
        {showImportRow && (
          <div className="flex flex-col gap-1.5 p-2 rounded bg-zinc-800/60 border border-zinc-700 mt-1">
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setShowLichessModal(true)} className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Lichess</button>
              <button onClick={() => fileInputRef.current?.click()} className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Upload file</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pgn,.txt"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); e.target.value = ''; }}
              />
            </div>
            <div className="flex gap-1.5 min-w-0">
              <input
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPgn(); }}
                placeholder="Paste a PGN or bare move-text: 1. e4 e5 2. Nf3 Nc6 …"
                className="min-w-0 flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
              />
              <button onClick={submitPgn} className="shrink-0 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">Go</button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Description</label>
        <input value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder="What's the idea here?" className={inputCls} />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Themes</label>
        <div className="flex flex-wrap gap-1.5">
          {themes.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-200">
              {t}
              <button onClick={() => onThemesChange(themes.filter((x) => x !== t))} className="text-zinc-500 hover:text-red-400 font-bold">✕</button>
            </span>
          ))}
          <input
            value={themeInput}
            onChange={(e) => setThemeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTheme(); } }}
            onBlur={addTheme}
            placeholder="+ add theme"
            className="text-xs px-2 py-0.5 rounded-full bg-transparent border border-dashed border-zinc-700 text-zinc-400 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 w-24"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Solution</label>
        <textarea
          value={localSolution}
          onChange={(e) => setLocalSolution(e.target.value)}
          onBlur={() => onApplySolutionText(localSolution)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onApplySolutionText(localSolution); (e.target as HTMLTextAreaElement).blur(); }
          }}
          rows={2}
          placeholder="Qxf7 dxc6 Qf3+  ·  or 1. Qxf7 dxc6  ·  or UCI: f7f8q d7c6  ·  or f7-f8=q d7-c6"
          className={`${inputCls} font-mono resize-none`}
        />
        <p className="text-[10px] text-zinc-600">
          Editable — typing here (Enter to apply) updates the board &amp; Moves tab, and vice versa. Move
          numbers are optional and regenerated automatically either way.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {!canSave && (
          <p className="text-[10px] text-zinc-500">Needs a description and at least one solution move.</p>
        )}
        <button
          onClick={onSave}
          disabled={!canSave}
          className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {isEditing ? 'Update puzzle' : 'Save puzzle'}
        </button>
      </div>

      {showLichessModal && (
        <LichessImportModal
          onClose={() => setShowLichessModal(false)}
          onImport={(puzzles) => { onImportLichess(puzzles); setShowLichessModal(false); setShowImportRow(false); }}
        />
      )}
    </div>
  );
}
