'use client';
import { useState, useEffect } from 'react';
import { Chess } from 'chess.js';

// ── Icons ─────────────────────────────────────────────────────────────────────

function ClipboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface FenBarProps {
  currentFen: string;
  onFenLoad: (fen: string) => void;
  onPgnLoad: (pgn: string) => void;
  exportPgn: () => string;
}

export function FenBar({ currentFen, onFenLoad, onPgnLoad, exportPgn }: FenBarProps) {
  const [fenInput, setFenInput] = useState(currentFen);
  const [fenError, setFenError] = useState(false);
  const [pgnInput, setPgnInput] = useState('');

  useEffect(() => {
    setFenInput(currentFen);
    setFenError(false);
  }, [currentFen]);

  const applyFen = (value: string) => {
    const trimmed = value.trim();
    try {
      new Chess(trimmed);
      setFenError(false);
      onFenLoad(trimmed);
    } catch {
      setFenError(true);
    }
  };

  const handleLoadPgn = () => {
    const trimmed = pgnInput.trim();
    if (!trimmed) return;
    onPgnLoad(trimmed);
    setPgnInput('');
  };

  const handleCopyFen = () => {
    navigator.clipboard.writeText(currentFen).catch(() => {});
  };

  const handleCopyPgn = () => {
    const pgn = exportPgn();
    navigator.clipboard.writeText(pgn).catch(() => {});
    setPgnInput(pgn);
  };

  const handleDownloadPgn = () => {
    const pgn = exportPgn();
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'game.pgn';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">

      {/* ── FEN column ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 leading-none">FEN</span>
        <input
          value={fenInput}
          onChange={(e) => { setFenInput(e.target.value); setFenError(false); }}
          onBlur={() => applyFen(fenInput)}
          onKeyDown={(e) => e.key === 'Enter' && applyFen(fenInput)}
          spellCheck={false}
          className={`w-full font-mono text-xs px-2.5 py-2 rounded-md bg-zinc-800/80 border ${
            fenError ? 'border-red-500 focus:border-red-400' : 'border-zinc-700 focus:border-blue-500'
          } focus:outline-none text-zinc-300 placeholder:text-zinc-600 transition-colors`}
          placeholder="Paste FEN to jump to position…"
        />
        <button
          onClick={handleCopyFen}
          className="flex items-center gap-1.5 self-start px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ClipboardIcon />
          <span>Copy FEN</span>
        </button>
      </div>

      {/* ── PGN column ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500 leading-none">PGN</span>
        <textarea
          className="w-full font-mono text-xs px-2.5 py-2 rounded-md bg-zinc-800/80 border border-zinc-700 focus:outline-none focus:border-blue-500 resize-none text-zinc-300 placeholder:text-zinc-600 transition-colors"
          rows={3}
          placeholder="Paste PGN here…"
          value={pgnInput}
          onChange={(e) => setPgnInput(e.target.value)}
          spellCheck={false}
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyPgn}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ClipboardIcon />
            <span>Copy PGN</span>
          </button>
          <button
            onClick={handleLoadPgn}
            disabled={!pgnInput.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UploadIcon />
            <span>Load PGN</span>
          </button>
          <button
            onClick={handleDownloadPgn}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors ml-auto"
          >
            <DownloadIcon />
            <span>Download</span>
          </button>
        </div>
      </div>

    </div>
  );
}
