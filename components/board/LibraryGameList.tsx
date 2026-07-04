'use client';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useFolderGames } from '@/hooks/useLibrary';
import { updateGame, deleteGame, deriveTitle } from '@/lib/library';
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

// Main-line move count from the raw PGN (headers/comments/variations stripped).
function countMoves(pgn: string): number {
  let body = pgn.replace(/^\[[^\]]*\]\s*$/gm, '').replace(/\{[^}]*\}/g, ' ');
  let prev: string;
  do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
  let plies = 0;
  for (let tok of body.split(/\s+/)) {
    tok = tok.replace(/^\d+\.+/, '');
    if (!tok || tok === '*' || /^(1-0|0-1|1\/2-1\/2)$/.test(tok) || tok.startsWith('$')) continue;
    plies++;
  }
  return Math.ceil(plies / 2);
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
  const moves = useMemo(() => countMoves(game.pgn), [game.pgn]);
  // Player ratings from the PGN, shown as W/B when either is present.
  const elos = (() => {
    const w = parseInt(game.headers.WhiteElo ?? '', 10);
    const b = parseInt(game.headers.BlackElo ?? '', 10);
    if (!w && !b) return null;
    return `${w || '?'}·${b || '?'}`;
  })();
  // Edited only counts when it happened meaningfully after the import/save.
  const edited = game.updatedAt - game.createdAt > 60_000;

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
        className={`group flex items-center gap-2.5 px-3 py-1.5 border-b border-zinc-800/70 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_58px] ${
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
          {/* Metadata strip: format · ECO · moves · elos · PGN date · analysed */}
          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] leading-none text-zinc-500">
            <span className={`px-1 py-0.5 rounded-sm border ${FORMAT_STYLE[format]} font-medium tracking-tight`}>
              {format}
            </span>
            {eco && <span className="font-mono text-zinc-400">{eco}</span>}
            {moves > 0 && <span className="tabular-nums">{moves} mv</span>}
            {elos && <span className="tabular-nums" title="White · Black rating">{elos}</span>}
            {pgnDate && <span className="tabular-nums">{pgnDate}</span>}
            {analysed && <span className="text-emerald-400/90 font-medium tracking-tight">Analysed</span>}
          </div>
        </div>

        {/* Result + timestamps — stacked, right-aligned */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <ResultBadge result={game.headers.Result} />
          <span
            className="text-[10px] text-zinc-500 tabular-nums tracking-tight leading-none"
            title={`Added ${new Date(game.createdAt).toLocaleString()}${edited ? ` · edited ${new Date(game.updatedAt).toLocaleString()}` : ''}`}
          >
            {formatDate(game.createdAt)}
          </span>
          {edited && (
            <span className="text-[9px] text-zinc-600 tabular-nums tracking-tight leading-none">
              ✎ {formatDate(game.updatedAt)}
            </span>
          )}
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
      {/* Game list — its own scroll container, so nothing overlays the rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
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
            <div className="px-3 py-1 text-[10px] tracking-tight text-zinc-500 border-b border-zinc-800/70 flex justify-between">
              <span>
                {filtersActive
                  ? `${filtered.length} of ${games.length} game${games.length !== 1 ? 's' : ''}`
                  : `${games.length} game${games.length !== 1 ? 's' : ''}`}
              </span>
              <span className="text-zinc-600">by last modified</span>
            </div>
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

      {/* Footer: save target action (import/export live on folders + header) */}
      {mode === 'save' && (
        <div className="shrink-0 px-3 py-2 border-t border-zinc-700/50 flex justify-end">
          <button
            onClick={onSaveHere}
            className="px-3 py-1 rounded text-[11px] font-semibold leading-none tracking-tight bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
          >
            + Save Here
          </button>
        </div>
      )}
    </div>
  );
}
