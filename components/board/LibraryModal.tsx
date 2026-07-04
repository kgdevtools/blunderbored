'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { LibraryGame } from '@/lib/db';
import { useFolderPath } from '@/hooks/useLibrary';
import { LibraryFolderTree } from './LibraryFolderTree';
import { LibraryGameList } from './LibraryGameList';
import { useFolderImport, ImportOverlays, ExportIcon, exportFolderDeep } from './LibraryImportExport';
import { ConceptList } from './ConceptList';
import { GraphView } from './GraphView';
import { PerformanceCharts, type ChartKind } from './PerformanceCharts';
import { PositionsManager } from '@/components/blunderable/PositionsManager';
import { hasActiveFilters, type GameFilters, type GameFormat } from '@/lib/gameMeta';

type Tab = 'folders' | 'concepts' | 'graph' | 'positions';

// ─── Icons ────────────────────────────────────────────────────────────────────

function FunnelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

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

// ─── Filter bar ───────────────────────────────────────────────────────────────

const FORMATS: GameFormat[] = ['Bullet', 'Blitz', 'Rapid', 'Classical', 'Normal'];
const RESULTS: { v: NonNullable<GameFilters['result']>; label: string }[] = [
  { v: '1-0', label: 'White' },
  { v: '0-1', label: 'Black' },
  { v: '1/2-1/2', label: 'Draw' },
];

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const dateInputCls = 'bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-200 [color-scheme:dark]';
const rowLabelCls = 'text-[10px] uppercase tracking-wide text-zinc-600 w-14 shrink-0';

function FilterBar({ filters, onChange }: { filters: GameFilters; onChange: (f: GameFilters) => void }) {
  const toggle = <K extends keyof GameFilters>(key: K, val: GameFilters[K]) =>
    onChange({ ...filters, [key]: filters[key] === val ? undefined : val });

  return (
    <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/40 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={rowLabelCls}>Result</span>
        {RESULTS.map((r) => (
          <FilterChip key={r.v} active={filters.result === r.v} onClick={() => toggle('result', r.v)}>{r.label}</FilterChip>
        ))}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={rowLabelCls}>Format</span>
        {FORMATS.map((f) => (
          <FilterChip key={f} active={filters.format === f} onClick={() => toggle('format', f)}>{f}</FilterChip>
        ))}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={rowLabelCls}>Analysis</span>
        <FilterChip active={filters.analysis === 'analysed'} onClick={() => toggle('analysis', 'analysed')}>Analysed</FilterChip>
        <FilterChip active={filters.analysis === 'unanalysed'} onClick={() => toggle('analysis', 'unanalysed')}>Unanalysed</FilterChip>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={rowLabelCls}>Date</span>
        <input
          type="date"
          aria-label="From date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
          className={dateInputCls}
        />
        <span className="text-zinc-600 text-[10px]">to</span>
        <input
          type="date"
          aria-label="To date"
          value={filters.dateTo ?? ''}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
          className={dateInputCls}
        />
        {hasActiveFilters(filters) && (
          <button onClick={() => onChange({})} className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

// ─── LibraryModal ─────────────────────────────────────────────────────────────

interface LibraryModalProps {
  mode: 'browse' | 'save';
  onSaveHere: (folderId: string) => void;
  onLoad: (game: LibraryGame) => void;
  onClose: () => void;
  currentGameId?: string | null;
  currentFolderId?: string | null;
}

export function LibraryModal({ mode, onSaveHere, onLoad, onClose, currentGameId, currentFolderId }: LibraryModalProps) {
  const router = useRouter();
  const [graphView, setGraphView] = useState<'network' | ChartKind>('network');
  const [filters, setFilters] = useState<GameFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  // Open onto the loaded game's folder so its row is visible (and highlighted).
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId ?? null);
  // Tabs only apply when browsing; saving is always folder-picking.
  const [tab, setTab] = useState<Tab>('folders');
  const activeTab: Tab = mode === 'save' ? 'folders' : tab;

  // Resizable + collapsible split. "Collapsed" is simply width 0, so the folder
  // panel hides and the game list takes the full width (key on mobile).
  const bodyRef = useRef<HTMLDivElement>(null);
  // Start collapsed on narrow screens so the game list keeps its width (titles
  // were truncated away on mobile). Safe to read window in the initializer: the
  // modal only ever mounts client-side (behind `showLibrary`), never via SSR.
  const [leftWidth, setLeftWidth] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 0 : 220,
  );
  const leftCollapsed = leftWidth === 0;
  // Dragging is state (not a ref) so the divider can restyle and the width
  // transition can be suspended while the pointer is down.
  const [dragging, setDragging] = useState(false);
  // Remember the last expanded width so toggling reopens where the user left it
  // (state, not a ref: it also sizes the panel's inner content during render).
  // Updated alongside leftWidth in the drag handler — the only place a new
  // expanded width can originate.
  const [lastExpandedWidth, setLastExpandedWidth] = useState(220);

  const toggleFolderPanel = useCallback(() => {
    setLeftWidth((w) => (w === 0 ? lastExpandedWidth : 0));
  }, [lastExpandedWidth]);

  // Pointer capture keeps move/up events flowing to the handle itself (mouse,
  // touch and pen alike) — no window listeners, no lost drags outside the modal.
  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);
  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const w = e.clientX - rect.left;
    // Drag (almost) to the edge → collapse (0); otherwise clamp to a usable range.
    const next = w < 90 ? 0 : Math.max(150, Math.min(w, rect.width - 240));
    setLeftWidth(next);
    if (next > 0) setLastExpandedWidth(next);
  }, []);
  const onHandlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
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

  // Import lifecycle (file → analyze → resolve → report) — one instance for the
  // whole modal; the folder tree calls importFile with the target folder.
  const { state: importState, importFile, resolveConflict, cancelConflict, dismissReport } = useFolderImport();

  const selPath = useFolderPath(selectedFolderId);
  const selName = selPath.length ? selPath[selPath.length - 1].name : 'library';
  const handleExportSelected = useCallback(async () => {
    if (!selectedFolderId) return;
    const n = await exportFolderDeep(selectedFolderId, selName);
    console.log(`[library] exported ${n} game(s) from "${selName}"`);
  }, [selectedFolderId, selName]);

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
            {activeTab === 'folders' && selectedFolderId && (
              <button
                onClick={handleExportSelected}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                title={`Export "${selName}" as PGN (incl. subfolders)`}
                aria-label="Export selected folder as PGN"
              >
                <ExportIcon size={13} />
              </button>
            )}
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
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0">
            {(['folders', 'concepts', 'graph', 'positions'] as const).map((t) => (
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
            {/* Filter toggle — right-aligned, applies to the folders game list */}
            {activeTab === 'folders' && (
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={[
                  'ml-auto relative p-1.5 rounded transition-colors',
                  showFilters || hasActiveFilters(filters)
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                ].join(' ')}
                title="Filter games"
                aria-label="Filter games"
                aria-pressed={showFilters}
              >
                <FunnelIcon />
                {hasActiveFilters(filters) && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
                )}
              </button>
            )}
          </div>
        )}

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        {mode === 'browse' && activeTab === 'folders' && showFilters && (
          <FilterBar filters={filters} onChange={setFilters} />
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {activeTab === 'folders' && (
          <div ref={bodyRef} className="flex flex-1 min-h-0">
            {/* Left: folder tree (resizable + collapsible). Stays mounted so
                collapse/expand slides instead of popping in and out. */}
            <div
              style={{ width: leftWidth }}
              className={[
                'shrink-0 overflow-hidden bg-zinc-900/30',
                dragging ? '' : 'transition-[width] duration-200 ease-out',
                leftCollapsed ? '' : 'border-r border-zinc-700/80',
              ].join(' ')}
            >
              {/* Inner keeps its expanded width so content doesn't reflow mid-slide. */}
              <div
                style={{ width: leftCollapsed ? lastExpandedWidth : leftWidth }}
                className="h-full overflow-y-auto"
              >
                <LibraryFolderTree
                  selectedFolderId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                  onLoad={(game) => { onLoad(game); onClose(); }}
                  onImportFile={importFile}
                  mode={mode}
                />
              </div>
            </div>

            {/* Drag handle + collapse/expand toggle */}
            <div className="relative w-2 shrink-0 select-none">
              <div className={`absolute inset-0 transition-colors ${dragging ? 'bg-blue-500' : 'bg-zinc-800'}`} />
              {/* Invisible oversized hit area: comfortable to grab by mouse or finger. */}
              <div
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerEnd}
                onPointerCancel={onHandlePointerEnd}
                onDoubleClick={toggleFolderPanel}
                className="absolute inset-y-0 -left-2.5 -right-2.5 z-10 cursor-col-resize touch-none"
                title="Drag to resize — drag fully left to collapse, double-click to toggle"
              />
              <button
                onClick={toggleFolderPanel}
                className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 z-20 grid place-items-center w-6 h-12 rounded-md bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 text-zinc-300 hover:text-white shadow-md transition-colors"
                title={leftCollapsed ? 'Show folders' : 'Hide folders'}
                aria-label={leftCollapsed ? 'Show folders' : 'Hide folders'}
              >
                <span className={`inline-flex transition-transform duration-200 ${leftCollapsed ? '' : 'rotate-180'}`}>
                  <ChevronIcon />
                </span>
              </button>
            </div>

            {/* Right: game list (scrolls internally so its footer never overlays rows) */}
            <div className="flex-1 min-w-0 min-h-0">
              <LibraryGameList
                folderId={selectedFolderId}
                mode={mode}
                onLoad={(game) => { onLoad(game); onClose(); }}
                onSaveHere={handleSaveHere}
                filters={filters}
                currentGameId={currentGameId}
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
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Sub-tabs: the network plus performance charts */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0 overflow-x-auto">
              {([['network', 'Network'], ['spider', 'Strength'], ['line', 'Trend'], ['bar', 'Ratings'], ['scatter', 'Scatter']] as const).map(([g, label]) => (
                <button
                  key={g}
                  onClick={() => setGraphView(g)}
                  className={[
                    'px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                    graphView === g ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {graphView === 'network'
                ? <GraphView onOpenGame={(game) => { onLoad(game); onClose(); }} />
                : <div className="h-full overflow-y-auto"><PerformanceCharts chart={graphView} /></div>}
            </div>
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <PositionsManager onPractice={(p) => { onClose(); router.push(`/blunderable?pos=${p.id}`); }} />
          </div>
        )}
      </div>

      {/* Import lifecycle overlays (progress / conflicts / report) */}
      <ImportOverlays
        state={importState}
        onResolve={resolveConflict}
        onCancel={cancelConflict}
        onDismissReport={dismissReport}
      />
    </div>
  );
}
