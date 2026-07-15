// Build public/openings/eco.json from the vendored lichess-org/chess-openings
// TSVs (data/openings/{a..e}.tsv, columns: eco \t name \t pgn).
//
//   npm run build:openings   (or: node scripts/build-openings.mjs)
//
// Keyed by EPD (first 4 FEN fields — move counters stripped so transpositions
// hit). Two kinds of entries share one map:
//   epd → [eco, name]  the FINAL position of a named row (names the position)
//   epd → 0            an interior position along a row (book, unnamed)
// A row's final position never renames an interior marker or an earlier row's
// final position (first-in-file wins — matches how lichess resolves lines that
// converge, e.g. Scotch Gambit C44 vs Two Knights C56 reaching the same EPD).
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = ['a', 'b', 'c', 'd', 'e'].map((f) => resolve(root, `data/openings/${f}.tsv`));
const OUT = resolve(root, 'public/openings/eco.json');

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

const positions = {};
let rows = 0, replayFailures = 0;
for (const file of SRC) {
  for (const row of readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) continue;
    rows++;
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
    } catch {
      replayFailures++;
      continue;
    }
    const sans = chess.history();
    chess.reset();
    sans.forEach((san, i) => {
      chess.move(san);
      const key = epd(chess.fen());
      const isFinal = i === sans.length - 1;
      if (isFinal) {
        // Name the row's final position unless an earlier row already did.
        if (!Array.isArray(positions[key])) positions[key] = [eco, name];
      } else {
        positions[key] ??= 0; // interior: book marker only, never overwrites a name
      }
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const payload = { v: 1, positions };
const json = JSON.stringify(payload);
writeFileSync(OUT, json);
const named = Object.values(positions).filter(Array.isArray).length;
console.log(
  `${rows} rows (${replayFailures} unparsable) → ${Object.keys(positions).length} EPDs ` +
  `(${named} named) → ${OUT} (${(Buffer.byteLength(json) / 1024).toFixed(0)} KB)`,
);
