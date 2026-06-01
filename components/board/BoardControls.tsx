'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function DownloadIcon() {
  return (
    <svg className="inline-block shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
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
}

const btn =
  'flex-1 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm transition-colors';

export function BoardControls({
  onStart, onPrev, onNext, onEnd, onFlip,
  canPrev, canNext,
  exportPgn,
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
          className="absolute bottom-full right-0 mb-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl py-1 min-w-[200px] text-sm"
        >
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={handleSendToGameReviewer}
          >
            Send to Game Reviewer
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={handleSendToPuzzleGenerator}
          >
            Send to Puzzle Generator
          </button>
          <div className="my-1 border-t border-zinc-700" />
          <button
            className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200"
            onClick={handleDownloadPgn}
          >
            <DownloadIcon />
            Download PGN
          </button>
        </div>
      )}
    </div>
  );
}
