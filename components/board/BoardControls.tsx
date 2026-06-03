'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const iconProps = {
  className: 'inline-block shrink-0',
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function DownloadIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.5}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.5}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

interface BoardControlsProps {
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnd: () => void;
  onFlip: () => void;
  canPrev: boolean;
  canNext: boolean;
  exportPgn: () => string;
  // 3-dot menu actions
  onNewGame: () => void;
  onAddGameData: () => void;
  onSaveToLibrary: () => void;
  onOpenLibrary: () => void;
  isLoaded: boolean;
}

const btn =
  'flex-1 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

const menuItem =
  'flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200';
const sectionLabel =
  'px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500';

export function BoardControls({
  onStart, onPrev, onNext, onEnd, onFlip,
  canPrev, canNext,
  exportPgn,
  onNewGame, onAddGameData, onSaveToLibrary, onOpenLibrary, isLoaded,
}: BoardControlsProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (e.key === 'Home') { e.preventDefault(); onStart(); }
      else if (e.key === 'End') { e.preventDefault(); onEnd(); }
      else if (e.key === 'f' || e.key === 'F') onFlip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStart, onPrev, onNext, onEnd, onFlip]);

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setShowMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showMenu]);

  const handleDownloadPgn = () => {
    const pgn = exportPgn();
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'game.pgn';
    a.click();
    URL.revokeObjectURL(url);
    setShowMenu(false);
  };

  const handleSendToGameReviewer = () => {
    router.push(`/game-reviewer?pgn=${encodeURIComponent(exportPgn())}`);
    setShowMenu(false);
  };

  const handleSendToPuzzleGenerator = () => {
    router.push(`/puzzle-generator?pgn=${encodeURIComponent(exportPgn())}`);
    setShowMenu(false);
  };

  // Wrap menu actions so the dropdown closes after each.
  const runAndClose = (fn: () => void) => () => { fn(); setShowMenu(false); };

  return (
    <div className="relative flex gap-0.5 pt-2 border-t border-zinc-700">
      <button className={btn} onClick={onStart} disabled={!canPrev} title="Start (Home)">⟨⟨</button>
      <button className={btn} onClick={onPrev}  disabled={!canPrev} title="Previous (←)">⟨</button>
      <button className={btn} onClick={onNext}  disabled={!canNext} title="Next (→)">⟩</button>
      <button className={btn} onClick={onEnd}   disabled={!canNext} title="End (End)">⟩⟩</button>
      <button className={btn} onClick={onFlip}  title="Flip board (F)">⇅</button>

      {/* 3-dot menu trigger */}
      <button
        ref={triggerRef}
        className="flex-none px-2 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors"
        onClick={() => setShowMenu((v) => !v)}
        title="More options"
      >
        ···
      </button>

      {/* Dropdown — opens upward */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[210px] text-sm max-h-[70vh] overflow-y-auto"
        >
          {/* ── Game ─────────────────────────────────────────────── */}
          <div className={sectionLabel}>Game</div>
          <button className={menuItem} onClick={runAndClose(onNewGame)}>
            <PlusIcon />
            New Game
          </button>
          <button className={menuItem} onClick={runAndClose(onAddGameData)}>
            <TagIcon />
            Add Game Data
          </button>

          {/* ── Library ──────────────────────────────────────────── */}
          <div className="my-1 border-t border-zinc-700" />
          <div className={sectionLabel}>Library</div>
          <button className={menuItem} onClick={runAndClose(onSaveToLibrary)}>
            <BookIcon />
            {isLoaded ? 'Update in Library' : 'Save to Library'}
          </button>
          <button className={menuItem} onClick={runAndClose(onOpenLibrary)}>
            <FolderIcon />
            Open from Library
          </button>

          {/* ── Export ───────────────────────────────────────────── */}
          <div className="my-1 border-t border-zinc-700" />
          <div className={sectionLabel}>Export</div>
          <button className={menuItem} onClick={handleSendToGameReviewer}>
            Send to Game Reviewer
          </button>
          <button className={menuItem} onClick={handleSendToPuzzleGenerator}>
            Send to Puzzle Generator
          </button>
          <button className={menuItem} onClick={handleDownloadPgn}>
            <DownloadIcon />
            Download PGN
          </button>
        </div>
      )}
    </div>
  );
}
