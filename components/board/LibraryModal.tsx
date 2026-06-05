'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { LibraryGame } from '@/lib/db';
import { useFolderPath } from '@/hooks/useLibrary';
import { LibraryFolderTree } from './LibraryFolderTree';
import { LibraryGameList } from './LibraryGameList';
import { ConceptList } from './ConceptList';
import { GraphView } from './GraphView';

type Tab = 'folders' | 'concepts' | 'graph';

// ─── Icons ────────────────────────────────────────────────────────────────────

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  folderId,
  onSelect,
}: {
  folderId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const path = useFolderPath(folderId);

  return (
    <div className="flex items-center gap-1 text-xs text-zinc-400 min-w-0 overflow-hidden">
      <button
        onClick={() => onSelect(null)}
        className="hover:text-zinc-200 transition-colors shrink-0"
      >
        Library
      </button>
      {path.map((crumb) => (
        <span key={crumb.id} className="flex items-center gap-1 min-w-0">
          <ChevronIcon />
          <button
            onClick={() => onSelect(crumb.id)}
            className="hover:text-zinc-200 transition-colors truncate max-w-[120px]"
            title={crumb.name}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </div>
  );
}

// ─── LibraryModal ─────────────────────────────────────────────────────────────

interface LibraryModalProps {
  mode: 'browse' | 'save';
  onSaveHere: (folderId: string) => void;
  onLoad: (game: LibraryGame) => void;
  onClose: () => void;
}

export function LibraryModal({ mode, onSaveHere, onLoad, onClose }: LibraryModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  // Tabs only apply when browsing; saving is always folder-picking.
  const [tab, setTab] = useState<Tab>('folders');
  const activeTab: Tab = mode === 'save' ? 'folders' : tab;

  // Resizable + collapsible split. "Collapsed" is simply width 0, so the folder
  // panel hides and the game list takes the full width (key on mobile).
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Start collapsed on narrow screens so the game list keeps its width (titles
  // were truncated away on mobile). Safe to read window in the initializer: the
  // modal only ever mounts client-side (behind `showLibrary`), never via SSR.
  const [leftWidth, setLeftWidth] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 0 : 220,
  );
  const leftCollapsed = leftWidth === 0;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const w = e.clientX - rect.left;
      // Drag (almost) to the edge → collapse (0); otherwise clamp to a usable range.
      setLeftWidth(w < 90 ? 0 : Math.max(150, Math.min(w, rect.width - 240)));
    };
    const onUp = () => { dragging.current = false; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSaveHere = useCallback(() => {
    if (selectedFolderId) onSaveHere(selectedFolderId);
  }, [selectedFolderId, onSaveHere]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog */}
      <div className="flex flex-col w-full max-w-4xl bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
        style={{ height: 'min(600px, 90vh)' }}
      >
        {/* ── Header bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/80 shrink-0">
          <div className="flex items-center gap-1.5 text-zinc-300 shrink-0">
            <BookIcon />
            <span className="text-xs font-semibold tracking-tight">Library</span>
          </div>

          <div className="flex-1 min-w-0">
            <Breadcrumb folderId={selectedFolderId} onSelect={setSelectedFolderId} />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {mode === 'save' && selectedFolderId && (
              <button
                onClick={handleSaveHere}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold leading-none transition-colors"
              >
                Save Here
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              aria-label="Close library"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* ── Tab strip (browse only) ────────────────────────────────────── */}
        {mode === 'browse' && (
          <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0">
            {(['folders', 'concepts', 'graph'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  'px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors',
                  activeTab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800',
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {activeTab === 'folders' && (
          <div ref={bodyRef} className="flex flex-1 min-h-0">
            {/* Left: folder tree (resizable + collapsible) */}
            {!leftCollapsed && (
              <div
                style={{ width: leftWidth }}
                className="shrink-0 border-r border-zinc-700/80 overflow-y-auto bg-zinc-900/30"
              >
                <LibraryFolderTree
                  selectedFolderId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                  onLoad={(game) => { onLoad(game); onClose(); }}
                  mode={mode}
                />
              </div>
            )}

            {/* Drag handle + collapse/expand toggle */}
            <div className="relative w-2 shrink-0">
              <div
                onPointerDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize'; }}
                className="absolute inset-0 cursor-col-resize bg-zinc-800 hover:bg-blue-500/60 active:bg-blue-500 transition-colors"
                title="Drag to resize — drag fully left to collapse"
              />
              <button
                onClick={() => setLeftWidth((w) => (w === 0 ? 220 : 0))}
                className="absolute top-2 left-1/2 -translate-x-1/2 z-10 grid place-items-center w-5 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white shadow-md transition-colors"
                title={leftCollapsed ? 'Show folders' : 'Hide folders'}
                aria-label={leftCollapsed ? 'Show folders' : 'Hide folders'}
              >
                <span className={`inline-flex transition-transform ${leftCollapsed ? '' : 'rotate-180'}`}>
                  <ChevronIcon />
                </span>
              </button>
            </div>

            {/* Right: game list */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              <LibraryGameList
                folderId={selectedFolderId}
                mode={mode}
                onLoad={(game) => { onLoad(game); onClose(); }}
                onSaveHere={handleSaveHere}
              />
            </div>
          </div>
        )}

        {activeTab === 'concepts' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ConceptList onOpenGame={(game) => { onLoad(game); onClose(); }} />
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="flex-1 min-h-0">
            <GraphView onOpenGame={(game) => { onLoad(game); onClose(); }} />
          </div>
        )}
      </div>
    </div>
  );
}
