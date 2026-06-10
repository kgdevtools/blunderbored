// Derived metadata + filtering for library games. Everything here reads from a
// game's PGN headers (and reviewData), so it needs no extra storage.

import type { LibraryGame } from './db';

export type GameFormat = 'Bullet' | 'Blitz' | 'Rapid' | 'Classical' | 'Normal';

// Classify a game by its TimeControl header using the Lichess convention:
// estimated duration = base + 40·increment seconds. No/!standard TimeControl
// (e.g. '-', correspondence, or absent) falls back to 'Normal'.
export function gameFormat(headers: Record<string, string>): GameFormat {
  const tc = headers.TimeControl?.trim();
  if (!tc || tc === '-' || tc === '?') return 'Normal';
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return 'Normal';
  const base = Number(m[1]);
  const inc = Number(m[2] ?? 0);
  const est = base + 40 * inc;
  if (est < 180) return 'Bullet';
  if (est < 480) return 'Blitz';
  if (est < 1500) return 'Rapid';
  return 'Classical';
}

// Parse a PGN Date tag ('YYYY.MM.DD', with '??' allowed for unknown parts) into
// a timestamp. Unknown month/day default to January / the 1st. Returns null when
// the year is unknown, so callers can treat the date as absent.
export function parsePgnDate(headers: Record<string, string>): number | null {
  const raw = headers.Date?.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4})\.(\d{2}|\?\?)\.(\d{2}|\?\?)$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isFinite(year)) return null;
  const month = m[2] === '??' ? 1 : Number(m[2]);
  const day = m[3] === '??' ? 1 : Number(m[3]);
  return new Date(year, month - 1, day).getTime();
}

// Compact human date for a row, e.g. "14 May 2021". Falls back to the raw tag.
export function formatPgnDate(headers: Record<string, string>): string | null {
  const ts = parsePgnDate(headers);
  if (ts == null) {
    const raw = headers.Date?.trim();
    return raw && raw !== '????.??.??' ? raw : null;
  }
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export interface GameFilters {
  result?: '1-0' | '0-1' | '1/2-1/2';
  format?: GameFormat;
  analysis?: 'analysed' | 'unanalysed';
  dateFrom?: string; // ISO 'YYYY-MM-DD' from <input type=date>
  dateTo?: string;
}

export function hasActiveFilters(f: GameFilters | undefined): boolean {
  return !!f && (!!f.result || !!f.format || !!f.analysis || !!f.dateFrom || !!f.dateTo);
}

export function matchesFilters(game: LibraryGame, f: GameFilters | undefined): boolean {
  if (!f) return true;

  if (f.result && game.headers.Result !== f.result) return false;
  if (f.format && gameFormat(game.headers) !== f.format) return false;
  if (f.analysis) {
    const analysed = game.reviewData != null;
    if (f.analysis === 'analysed' && !analysed) return false;
    if (f.analysis === 'unanalysed' && analysed) return false;
  }
  if (f.dateFrom || f.dateTo) {
    const ts = parsePgnDate(game.headers);
    if (ts == null) return false; // a date filter excludes undated games
    if (f.dateFrom && ts < new Date(f.dateFrom).getTime()) return false;
    // Include the whole 'to' day by pushing to its end.
    if (f.dateTo && ts > new Date(f.dateTo).getTime() + 86_399_999) return false;
  }
  return true;
}
