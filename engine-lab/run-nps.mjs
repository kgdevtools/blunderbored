// Raw speed benchmark: nodes/sec the WASM Lite build sustains, and how deep it
// gets in a fixed time. Speed is the hard ceiling on tactical strength — a slow
// engine simply can't see far enough, regardless of Elo settings.

import { Engine } from './driver.mjs';
import { POSITIONS } from './positions.mjs';

const MS = Number(process.argv[2] ?? 2000);

async function main() {
  const e = new Engine();
  await e.uci();
  e.setoption('Hash', 64);
  e.setoption('Threads', 1);
  await e.isready();

  console.log(`\nFixed ${MS}ms search per position (Hash 64, 1 thread):\n`);
  console.log('position     depth   knps     knodes');
  console.log('───────────────────────────────────────');
  let totalNps = 0, n = 0;
  for (const p of POSITIONS) {
    await e.newgame();
    const r = await e.go(p.fen, `movetime ${MS}`);
    totalNps += r.nps || 0; n++;
    console.log(
      p.id.padEnd(12) +
      String(r.depth ?? '?').padStart(3) + '   ' +
      String(Math.round((r.nps || 0) / 1000)).padStart(6) + '   ' +
      String(Math.round((r.nodes || 0) / 1000)).padStart(7),
    );
  }
  console.log('───────────────────────────────────────');
  console.log(`mean nps ≈ ${Math.round(totalNps / n / 1000)}k`);
  console.log('\nReference: native Stockfish on a desktop = millions of nps (10–100× this).');
  console.log('A WASM single-thread Lite build trades strength for "runs offline in a tab".\n');
  e.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });
