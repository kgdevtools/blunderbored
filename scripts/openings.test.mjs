// Tests for the built ECO dataset (public/openings/eco.json) — EPD keying,
// transposition resolution, and the deepest-name-wins collision rule.
// Run: node scripts/openings.test.mjs   (after: node scripts/build-openings.mjs)
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { positions } = JSON.parse(readFileSync(resolve(root, 'public/openings/eco.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) pass++;
  else { fail++; console.error(`  ✗ ${label}  got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
};

const epdAfter = (moves) => {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen().split(' ').slice(0, 4).join(' ');
};

// Italian Game mainline position is named theory.
{
  const hit = positions[epdAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])];
  check('Italian Game found', hit?.[0], 'C50');
  check('Italian Game named', hit?.[1]?.startsWith('Italian Game'), true);
}

// Transposition: the stress game reached the Scotch Gambit via 2.Bc4 (Bishop's
// Opening order) — the EPD must resolve to the same named line as 2.Nf3 order.
{
  const viaBishop = epdAfter(['e4', 'e5', 'Bc4', 'Nf6', 'Nf3', 'Nc6', 'd4', 'exd4']);
  const viaScotch = epdAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd4']);
  check('orders converge to one EPD', viaBishop, viaScotch);
  const hit = positions[viaBishop];
  check('transposition hits C44', hit?.[0], 'C44');
  check('Dubois Réti named', hit?.[1], 'Scotch Game: Scotch Gambit, Dubois Réti Defense');
}

// Interior positions of long rows are book markers (0), never renamed finals.
{
  check('1.e4 is named', Array.isArray(positions[epdAfter(['e4'])]), true);
  const shallow = positions[epdAfter(['e4', 'e5'])];
  const deep = positions[epdAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd4'])];
  check('deep line differs from shallow family', deep?.[1] !== shallow?.[1], true);
  // A position that is only ever mid-line stays a 0 marker (book, unnamed):
  // the Max Lange path 5.O-O passes through many interior-only positions.
  check('shallow family named', Array.isArray(shallow), true);
}

// Random middlegame position is not theory.
{
  const c = new Chess();
  for (const m of ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+']) c.move(m); // non-theory queen grab
  const key = c.fen().split(' ').slice(0, 4).join(' ');
  check('non-theory position misses', positions[key], undefined);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
