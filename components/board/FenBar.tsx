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
  onPgnLoad: (pgn: string) => boolean;
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
    // Keep the text on failure so the user doesn't lose their paste.
    if (onPgnLoad(trimmed)) setPgnInput('');
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
    <details className="group mt-1 rounded-md border border-zinc-800 bg-zinc-900/40">
      {/* Collapsed by default — click to reveal FEN / PGN tools */}
      <summary className="flex cursor-pointer list-none select-none items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest leading-none text-zinc-500 transition-colors hover:text-zinc-300">
        <span className="transition-transform group-open:rotate-90">▸</span>
        FEN / PGN
      </summary>

      <div className="grid grid-cols-1 gap-2 px-2.5 pb-2.5 pt-0.5 md:grid-cols-2">

        {/* ── FEN column ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-widest text-zinc-500">FEN</span>
          <input
            value={fenInput}
            onChange={(e) => { setFenInput(e.target.value); setFenError(false); }}
            onBlur={() => applyFen(fenInput)}
            onKeyDown={(e) => e.key === 'Enter' && applyFen(fenInput)}
            spellCheck={false}
            className={`w-full rounded-md border px-2.5 py-1.5 font-mono text-xs leading-tight bg-zinc-800/80 ${
              fenError ? 'border-red-500 focus:border-red-400' : 'border-zinc-700 focus:border-blue-500'
            } text-zinc-300 placeholder:text-zinc-600 transition-colors focus:outline-none`}
            placeholder="Paste FEN to jump to position…"
          />
          <button
            onClick={handleCopyFen}
            className="flex items-center gap-1.5 self-start rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs leading-none text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <ClipboardIcon />
            <span>Copy FEN</span>
          </button>
        </div>

        {/* ── PGN column ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-widest text-zinc-500">PGN</span>
          <textarea
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 font-mono text-xs leading-tight text-zinc-300 placeholder:text-zinc-600 transition-colors focus:border-blue-500 focus:outline-none"
            rows={2}
            placeholder="Paste PGN here…"
            value={pgnInput}
            onChange={(e) => setPgnInput(e.target.value)}
            spellCheck={false}
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopyPgn}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs leading-none text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
            >
              <ClipboardIcon />
              <span>Copy PGN</span>
            </button>
            <button
              onClick={handleLoadPgn}
              disabled={!pgnInput.trim()}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold leading-none text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UploadIcon />
              <span>Load PGN</span>
            </button>
            <button
              onClick={handleDownloadPgn}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs leading-none text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
            >
              <DownloadIcon />
              <span>Download</span>
            </button>
          </div>
        </div>

      </div>
    </details>
  );
}
