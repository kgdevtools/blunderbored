'use client';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useFolderGames } from '@/hooks/useLibrary';
import { updateGame, deleteGame, parsePgnGames, deriveTitle, analyzeImport, addParsedGames, replaceWithParsed, type ImportAnalysis } from '@/lib/library';
import type { LibraryGame } from '@/lib/db';
import { gameFormat, formatPgnDate, matchesFilters, hasActiveFilters, type GameFilters } from '@/lib/gameMeta';
import { GameInfoModal } from './GameInfoModal';

// Tints for the format chip so blitz/rapid/classical read apart at a glance.
const FORMAT_STYLE: Record<string, string> = {
  Bullet: 'text-rose-300 border-rose-800/50',
  Blitz: 'text-amber-300 border-amber-800/50',
  Rapid: 'text-emerald-300 border-emerald-800/50',
  Classical: 'text-sky-300 border-sky-800/50',
  Normal: 'text-zinc-400 border-zinc-700/60',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Uniform-width result chip: same footprint for 1-0 / 0-1 / ½-½ so the column
// reads cleanly. Fills its (content-sized) element; '*'/unknown shows a dash.
function ResultBadge({ result }: { result?: string }) {
  if (!result || result === '*') {
    return <span className="text-[10px] leading-none text-zinc-600 tabular-nums">—</span>;
  }
  const cls =
    result === '1-0'
      ? 'bg-zinc-100 text-zinc-900'
      : result === '0-1'
        ? 'bg-zinc-900 text-zinc-100 border border-zinc-600'
        : 'bg-zinc-700 text-zinc-300';
  return <span className={`min-w-[2.4rem] justify-center px-1.5 py-0.5 rounded text-[11px] font-bold leading-none inline-flex items-center tabular-nums ${cls}`}>{result}</span>;
}

// ─── Action icons ─────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Edit headers overlay ─────────────────────────────────────────────────────

function EditHeadersOverlay({ game, onClose }: { game: LibraryGame; onClose: () => void }) {
  const [localHeaders, setLocalHeaders] = useState<Record<string, string>>({ ...game.headers });

  const setHeader = useCallback((key: string, value: string) => {
    setLocalHeaders(prev => {
      if (value === '') {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const handleClose = useCallback(async () => {
    await updateGame(game.id, {
      headers: localHeaders,
      title: deriveTitle(localHeaders),
    });
    onClose();
  }, [game.id, localHeaders, onClose]);

  return (
    <GameInfoModal
      headers={localHeaders}
      onSetHeader={setHeader}
      onClose={handleClose}
    />
  );
}

// ─── Game row ─────────────────────────────────────────────────────────────────

function GameRow({
  game,
  index,
  mode,
  onLoad,
  onSaveHere,
  isCurrent,
}: {
  game: LibraryGame;
  index: number;
  mode: 'browse' | 'save';
  onLoad: (g: LibraryGame) => void;
  onSaveHere: () => void;
  isCurrent?: boolean;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingHeaders, setIsEditingHeaders] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Bring the currently-open game into view when the library opens onto it.
  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  // Secondary line: real context (event / opening) rather than repeating the
  // players, which are already the title.
  const detail = [game.headers.Event, game.headers.Opening || game.headers.ECO]
    .filter((s) => s && s.trim())
    .join('  ·  ');
  const format = gameFormat(game.headers);
  const pgnDate = formatPgnDate(game.headers);
  const eco = game.headers.ECO?.trim();
  const analysed = game.reviewData != null;

  // ── Deleting confirmation ────────────────────────────────────────────────
  if (isDeleting) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs bg-red-950/40 border-y border-red-800/40">
        <span className="text-red-300 flex-1 min-w-0 truncate">Delete &ldquo;{game.title}&rdquo;?</span>
        <button
          className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold shrink-0 transition-colors"
          onClick={async () => { await deleteGame(game.id); setIsDeleting(false); }}
        >Delete</button>
        <button
          className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] shrink-0 transition-colors"
          onClick={() => setIsDeleting(false)}
        >Cancel</button>
      </div>
    );
  }

  const clickable = mode === 'browse';

  // ── Normal ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={rowRef}
        className={`group flex items-center gap-2.5 px-3 py-1.5 border-b border-zinc-800/70 transition-colors ${
          isCurrent ? 'bg-blue-950/50 border-l-2 border-l-blue-500' : ''
        } ${clickable ? 'cursor-pointer hover:bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
        onClick={clickable ? () => onLoad(game) : undefined}
        title={clickable ? 'Open game' : undefined}
      >
        {/* Index */}
        <span className="text-[11px] tabular-nums text-zinc-600 shrink-0 w-4 text-right">{index}</span>

        {/* Title + context */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {isCurrent && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" title="Currently open" />
            )}
            <span className="text-[13px] font-semibold tracking-tight text-zinc-100 truncate leading-tight">
              {game.title}
            </span>
          </div>
          {detail && (
            <div className="text-[10px] tracking-tight text-zinc-500 truncate leading-tight mt-px">{detail}</div>
          )}
          {/* Metadata strip: format · ECO · PGN date · analysed */}
          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] leading-none text-zinc-500">
            <span className={`px-1 py-0.5 rounded-sm border ${FORMAT_STYLE[format]} font-medium tracking-tight`}>
              {format}
            </span>
            {eco && <span className="font-mono text-zinc-400">{eco}</span>}
            {pgnDate && <span className="tabular-nums">{pgnDate}</span>}
            {analysed && <span className="text-emerald-400/90 font-medium tracking-tight">Analysed</span>}
          </div>
        </div>

        {/* Result + saved date — own wrapper, stacked, right-aligned */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <ResultBadge result={game.headers.Result} />
          <span className="text-[10px] text-zinc-500 tabular-nums tracking-tight leading-none">
            {formatDate(game.updatedAt)}
          </span>
        </div>

        {/* Actions — icon-only to save space; visible on touch, hover on desktop */}
        <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {mode === 'save' && (
            <button
              onClick={(e) => { e.stopPropagation(); onSaveHere(); }}
              className="p-1.5 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/40 transition-colors"
              title="Update this game"
              aria-label="Update this game"
            ><CheckIcon /></button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditingHeaders(true); }}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
            title="Edit game data"
            aria-label="Edit game data"
          ><PencilIcon /></button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsDeleting(true); }}
            className="p-1.5 rounded text-red-400/80 hover:text-red-300 hover:bg-red-900/50 transition-colors"
            title="Delete game"
            aria-label="Delete game"
          ><TrashIcon /></button>
        </div>
      </div>

      {isEditingHeaders && (
        <EditHeadersOverlay game={game} onClose={() => setIsEditingHeaders(false)} />
      )}
    </>
  );
}

// ─── LibraryGameList ──────────────────────────────────────────────────────────

interface LibraryGameListProps {
  folderId: string | null;
  mode: 'browse' | 'save';
  onLoad: (game: LibraryGame) => void;
  onSaveHere: () => void;
  filters?: GameFilters;
  currentGameId?: string | null;
}

export function LibraryGameList({ folderId, mode, onLoad, onSaveHere, filters, currentGameId }: LibraryGameListProps) {
  const games = useFolderGames(folderId);
  const filtered = useMemo(() => games.filter((g) => matchesFilters(g, filters)), [games, filters]);
  const filtersActive = hasActiveFilters(filters);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  // Set when an import contains games that already exist — drives the resolve modal.
  const [conflict, setConflict] = useState<ImportAnalysis | null>(null);

  const handleImportPgn = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !folderId) return;
    e.target.value = '';

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = parsePgnGames(text);
      if (parsed.length === 0) {
        setImportResult('No valid games found in the file.');
        return;
      }
      const analysis = await analyzeImport(folderId, parsed);
      if (analysis.conflicts.length === 0) {
        const added = await addParsedGames(folderId, analysis.fresh);
        setImportResult(`${added} game${added !== 1 ? 's' : ''} imported`);
      } else {
        setConflict(analysis); // ask the user how to resolve
      }
    } catch {
      setImportResult('Failed to import — check the file and try again.');
    } finally {
      setImporting(false);
    }
  }, [folderId]);

  // Apply the user's conflict choice and run the deferred import.
  const resolveImport = useCallback(async (action: 'skip' | 'replace' | 'keep') => {
    if (!conflict || !folderId) return;
    const { fresh, conflicts } = conflict;
    setConflict(null);
    setImporting(true);
    try {
      const toAdd = action === 'keep' ? [...fresh, ...conflicts.map((c) => c.incoming)] : fresh;
      const added = await addParsedGames(folderId, toAdd);
      let replaced = 0;
      if (action === 'replace') {
        for (const c of conflicts) { await replaceWithParsed(c.existingId, c.incoming); replaced++; }
      }
      const skipped = action === 'skip' ? conflicts.length : 0;
      const parts = [`${added} imported`];
      if (replaced) parts.push(`${replaced} replaced`);
      if (skipped) parts.push(`${skipped} skipped`);
      setImportResult(parts.join(', '));
    } catch {
      setImportResult('Failed to import — check the file and try again.');
    } finally {
      setImporting(false);
    }
  }, [conflict, folderId]);

  // ── Empty / no folder states ───────────────────────────────────────────────
  if (!folderId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1.5 p-5 text-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-700">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-[10px] tracking-tight text-zinc-600">Select a folder to view games</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Game list */}
      <div className="flex-1 min-h-0">
        {games.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 p-5 text-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-700">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="text-[10px] tracking-tight text-zinc-600">No games in this folder</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 p-5 text-center">
            <p className="text-[11px] tracking-tight text-zinc-500">No games match the filters</p>
            <p className="text-[10px] tracking-tight text-zinc-600">{games.length} hidden</p>
          </div>
        ) : (
          <>
            {filtersActive && (
              <div className="px-3 py-1 text-[10px] tracking-tight text-zinc-500 border-b border-zinc-800/70">
                {filtered.length} of {games.length} game{games.length !== 1 ? 's' : ''}
              </div>
            )}
            {filtered.map((game, i) => (
              <GameRow
                key={game.id}
                game={game}
                index={i + 1}
                mode={mode}
                onLoad={onLoad}
                onSaveHere={onSaveHere}
                isCurrent={!!currentGameId && game.id === currentGameId}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer: save + import */}
      <div className="shrink-0 px-3 py-2 border-t border-zinc-700/50 flex flex-col gap-1">
        <div className="flex justify-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing || !folderId}
            className="px-3 py-1 rounded-l text-[11px] font-semibold leading-none tracking-tight bg-zinc-800 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-zinc-700/60 border-r-0"
          >
            {importing ? 'Importing…' : '↑ Import PGN'}
          </button>
          <button
            onClick={onSaveHere}
            className={`px-3 py-1 rounded-r text-[11px] font-semibold leading-none tracking-tight transition-colors
              ${mode === 'save'
                ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'}`}
          >
            {mode === 'save' ? '+ Save Here' : '+ Save'}
          </button>
        </div>

        {importResult && (
          <p className={`text-xs font-semibold leading-tight tracking-tight ${importResult.includes('Failed') ? 'text-red-400' : 'text-emerald-400'}`}>
            {importResult}
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          // Broad accept so the OS file dialog never greys out a valid .pgn
          // (some Linux/Chromium pickers filter by MIME, not extension). The
          // parser validates content regardless.
          accept=".pgn,.PGN,.txt,application/x-chess-pgn,application/vnd.chess-pgn,application/octet-stream,text/plain"
          className="hidden"
          onChange={handleImportPgn}
        />
      </div>

      {conflict && (
        <ImportConflictModal
          analysis={conflict}
          onResolve={resolveImport}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  );
}

// ─── Import conflict resolution modal ─────────────────────────────────────────

function ImportConflictModal({
  analysis,
  onResolve,
  onCancel,
}: {
  analysis: ImportAnalysis;
  onResolve: (action: 'skip' | 'replace' | 'keep') => void;
  onCancel: () => void;
}) {
  const { fresh, conflicts } = analysis;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2 shrink-0">
          <h3 className="text-sm font-semibold text-zinc-100">
            {conflicts.length} duplicate{conflicts.length !== 1 ? 's' : ''} found
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            {conflicts.length === 1 ? 'This game is' : 'These games are'} already in this folder
            {fresh.length > 0 && ` · ${fresh.length} new game${fresh.length !== 1 ? 's' : ''} will import either way`}.
          </p>
        </div>

        <ul className="px-4 py-1 overflow-y-auto text-xs text-zinc-300 space-y-0.5 min-h-0">
          {conflicts.map((c, i) => (
            <li key={i} className="truncate flex gap-1.5">
              <span className="text-zinc-600 tabular-nums shrink-0">{i + 1}.</span>
              <span className="truncate">{c.existingTitle}</span>
            </li>
          ))}
        </ul>

        <div className="px-4 pt-3 pb-4 flex flex-col gap-1.5 shrink-0 border-t border-zinc-700/60 mt-2">
          <button
            onClick={() => onResolve('skip')}
            className="w-full py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold transition-colors"
          >
            Skip duplicates {fresh.length > 0 && `(import ${fresh.length} new only)`}
          </button>
          <button
            onClick={() => onResolve('replace')}
            className="w-full py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            Replace existing with imported
          </button>
          <button
            onClick={() => onResolve('keep')}
            className="w-full py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold transition-colors"
          >
            Keep both (import as copies)
          </button>
          <button
            onClick={onCancel}
            className="w-full py-1.5 rounded text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
