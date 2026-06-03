'use client';
import { useState, useRef, useCallback } from 'react';
import { useFolderGames } from '@/hooks/useLibrary';
import { updateGame, deleteGame, saveGame, checkDuplicate, parsePgnGames, deriveTitle } from '@/lib/library';
import type { LibraryGame } from '@/lib/db';
import { GameInfoModal } from './GameInfoModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ResultBadge({ result }: { result?: string }) {
  if (!result || result === '*') return null;
  const cls =
    result === '1-0'
      ? 'bg-zinc-100 text-zinc-900'
      : result === '0-1'
        ? 'bg-zinc-900 text-zinc-100 border border-zinc-600'
        : 'bg-zinc-700 text-zinc-300';
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none shrink-0 inline-flex items-center ${cls}`}>{result}</span>;
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
}: {
  game: LibraryGame;
  index: number;
  mode: 'browse' | 'save';
  onLoad: (g: LibraryGame) => void;
  onSaveHere: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingHeaders, setIsEditingHeaders] = useState(false);

  // Secondary line: real context (event / opening) rather than repeating the
  // players, which are already the title.
  const detail = [game.headers.Event, game.headers.Opening || game.headers.ECO]
    .filter((s) => s && s.trim())
    .join('  ·  ');

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
        className={`group flex items-center gap-3 px-4 py-2 border-b border-zinc-800/70 transition-colors ${clickable ? 'cursor-pointer hover:bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
        onClick={clickable ? () => onLoad(game) : undefined}
        title={clickable ? 'Open game' : undefined}
      >
        {/* Index */}
        <span className="text-xs tabular-nums text-zinc-600 shrink-0 w-5 text-right">{index}.</span>

        {/* Title + context */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-tight text-zinc-100 truncate">
            {game.title}
          </div>
          {detail && (
            <div className="text-[11px] tracking-tight text-zinc-500 truncate mt-0.5">{detail}</div>
          )}
        </div>

        {/* Result + date */}
        <div className="flex items-center gap-2 shrink-0">
          <ResultBadge result={game.headers.Result} />
          <span className="text-[11px] text-zinc-500 tabular-nums tracking-tight w-20 text-right hidden sm:block">
            {formatDate(game.updatedAt)}
          </span>
        </div>

        {/* Actions — always visible on touch, hover-revealed on desktop */}
        <div className="flex items-center gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {mode === 'save' && (
            <button
              onClick={(e) => { e.stopPropagation(); onSaveHere(); }}
              className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold leading-none transition-colors"
            >Update</button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditingHeaders(true); }}
            className="px-2.5 py-1 rounded text-[11px] font-medium leading-none text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
            title="Edit game data"
          >Edit</button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsDeleting(true); }}
            className="px-2.5 py-1 rounded text-[11px] font-medium leading-none text-red-400/80 bg-zinc-800 hover:bg-red-900/60 hover:text-red-300 transition-colors"
            title="Delete game"
          >Delete</button>
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
}

export function LibraryGameList({ folderId, mode, onLoad, onSaveHere }: LibraryGameListProps) {
  const games = useFolderGames(folderId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

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
      let saved = 0;
      let dupes = 0;
      for (const game of parsed) {
        const isDup = await checkDuplicate(folderId, game.pgn);
        if (isDup) { dupes++; continue; }
        await saveGame({
          folderId,
          title: game.title,
          pgn: game.pgn,
          headers: game.headers,
          nodeComments: {},
          annotations: {},
          reviewData: null,
        });
        saved++;
      }
      const msg = dupes > 0
        ? `${saved} game${saved !== 1 ? 's' : ''} imported, ${dupes} duplicate${dupes !== 1 ? 's' : ''} skipped`
        : `${saved} game${saved !== 1 ? 's' : ''} imported`;
      setImportResult(msg);
    } catch {
      setImportResult('Failed to import — check the file and try again.');
    } finally {
      setImporting(false);
    }
  }, [folderId]);

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
        ) : (
          games.map((game, i) => (
            <GameRow
              key={game.id}
              game={game}
              index={i + 1}
              mode={mode}
              onLoad={onLoad}
              onSaveHere={onSaveHere}
            />
          ))
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
          accept=".pgn,.txt"
          className="hidden"
          onChange={handleImportPgn}
        />
      </div>
    </div>
  );
}
