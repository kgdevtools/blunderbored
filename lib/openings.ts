// ECO opening dataset: book-move classification + opening naming.
//
// Backed by public/openings/eco.json (built by scripts/build-openings.mjs from
// the vendored lichess-org/chess-openings TSVs): every position along every
// named line, keyed by EPD (first 4 FEN fields) so transpositions resolve.
// Lazy-loaded on first use; a fetch failure logs once and degrades to "no
// dataset" (callers fall back to the old opening heuristic).

export interface OpeningInfo {
  eco:  string;
  name: string;
}

// Entry values: [eco, name] = final position of a named row; 0 = interior
// position along a row (book, unnamed). See scripts/build-openings.mjs.
type EcoEntry = [string, string] | 0;
type EcoPayload = { v: number; positions: Record<string, EcoEntry> };

let _positions: Record<string, EcoEntry> | null = null;
let _loadPromise: Promise<void> | null = null;
let _loadFailed = false;

function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function ensureOpeningsLoaded(): Promise<void> {
  if (_positions || _loadFailed) return Promise.resolve();
  _loadPromise ??= fetch('/openings/eco.json')
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as EcoPayload;
      _positions = data.positions;
    })
    .catch((err) => {
      _loadFailed = true;
      console.warn(`[openings] ECO dataset unavailable (${err?.message ?? err}) — falling back to opening heuristic`);
    });
  return _loadPromise;
}

export function isOpeningsAvailable(): boolean {
  return _positions !== null;
}

// The reached position is known theory → the move that reached it is "book".
export function isBookPosition(fen: string): boolean {
  return _positions !== null && epd(fen) in _positions;
}

export function lookupOpening(fen: string): OpeningInfo | null {
  const hit = _positions?.[epd(fen)];
  return Array.isArray(hit) ? { eco: hit[0], name: hit[1] } : null;
}

// Deepest named position along the game's mainline — the game's opening.
export function openingForGame(fens: string[]): OpeningInfo | null {
  if (!_positions) return null;
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = lookupOpening(fens[i]);
    if (hit) return hit;
  }
  return null;
}
