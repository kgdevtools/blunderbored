// MultiPV depth-safety spike: find the highest depth the shipped WASM Lite
// build survives with MultiPV 2 at the app's Hash 4 setting. The app's
// documented safe point (depth 14) was measured with MultiPV 3; the reviewer's
// deep pass wants MultiPV 2, so measure that directly.
//
//   node engine-lab/run-multipv.mjs            # full matrix
//   node engine-lab/run-multipv.mjs 16         # single depth
//
// A config passes only if every position completes without the engine process
// dying or stalling past the watchdog.

import { Engine } from './driver.mjs';
import { POSITIONS } from './positions.mjs';
import { Chess } from 'chess.js';

const ONLY_DEPTH = process.argv[2] ? Number(process.argv[2]) : null;
const WATCHDOG_MS = 120_000;

// Real-game positions (the reviewer's actual workload) — a 40-ply game with
// tactical swings, replayed into FENs; every 3rd position keeps runtime sane.
const GAME_MOVES =
  '1. e4 e5 2. Bc4 Nf6 3. Nf3 Nc6 4. d4 exd4 5. Nxd4 Nxd4 6. Qxd4 d6 7. Nc3 Be7 ' +
  '8. O-O O-O 9. Qd1 d5 10. exd5 c6 11. Bd2 cxd5 12. Nxd5 Be6 13. Nxe7+ Qxe7 ' +
  '14. Qf3 Bxc4 15. b3 Bb5 16. a3 Rfe8 17. Bb4 b6 18. Bxe7 Rxe7 19. a4 Be8 20. c4 a6';

function gamePositions() {
  const c = new Chess();
  c.loadPgn(GAME_MOVES);
  const hist = c.history();
  while (c.history().length > 0) c.undo();
  const fens = [];
  hist.forEach((san, i) => {
    c.move(san);
    if (i % 3 === 2) fens.push({ id: `game-p${i + 1}`, fen: c.fen() });
  });
  return fens;
}

const CONFIGS = [
  { depth: 14, multipv: 2 },
  { depth: 16, multipv: 2 },
  { depth: 18, multipv: 2 },
].filter((c) => ONLY_DEPTH === null || c.depth === ONLY_DEPTH);

async function runConfig({ depth, multipv }, positions) {
  console.log(`\n── depth ${depth} · MultiPV ${multipv} · Hash 4 ─────────────────`);
  const e = new Engine();
  let crashed = false;
  e.proc.on('exit', (code, sig) => {
    if (code !== 0 && sig !== 'SIGKILL') crashed = true;
  });
  await e.uci();
  e.setoption('Hash', 4);
  e.setoption('Threads', 1);
  e.setoption('MultiPV', multipv);
  await e.isready();

  let ok = 0, fail = 0, totalMs = 0;
  for (const p of positions) {
    const t0 = Date.now();
    try {
      const result = await Promise.race([
        e.goMulti(p.fen, `depth ${depth}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('watchdog')), WATCHDOG_MS)),
      ]);
      const ms = Date.now() - t0;
      totalMs += ms;
      const lines = result.length;
      ok++;
      console.log(`  ${p.id.padEnd(12)} ok    ${String(ms).padStart(6)}ms  ${lines} line(s)`);
    } catch (err) {
      fail++;
      console.log(`  ${p.id.padEnd(12)} FAIL  ${err.message}${crashed ? ' (process died)' : ''}`);
      if (crashed) break;
    }
  }
  e.quit();
  const verdict = fail === 0 ? 'PASS' : 'FAIL';
  console.log(`  → ${verdict}: ${ok}/${ok + fail} ok · mean ${ok ? Math.round(totalMs / ok) : 0}ms/pos`);
  return { depth, multipv, verdict, ok, fail, meanMs: ok ? Math.round(totalMs / ok) : 0 };
}

async function main() {
  const positions = [...POSITIONS, ...gamePositions()];
  console.log(`${positions.length} positions × ${CONFIGS.length} config(s), watchdog ${WATCHDOG_MS / 1000}s`);
  const results = [];
  for (const cfg of CONFIGS) results.push(await runConfig(cfg, positions));
  console.log('\n══ summary ══');
  for (const r of results)
    console.log(`  d${r.depth}/pv${r.multipv}: ${r.verdict} (${r.ok}/${r.ok + r.fail}, mean ${r.meanMs}ms)`);
  const best = results.filter((r) => r.verdict === 'PASS').at(-1);
  console.log(best
    ? `\nrecommended PASS2_DEPTH = ${best.depth} (MultiPV 2)`
    : '\nno config passed — keep PASS2_DEPTH at 12');
}
main().catch((e) => { console.error(e); process.exit(1); });
