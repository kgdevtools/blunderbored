// Ad-hoc probe: throw a position at the engine under any config and see what it
// plays + how the referee rates that move.
//
//   node engine-lab/probe.mjs "<fen>" [--elo 2250] [--movetime 1500] [--skill N] [--hash 4]
//   node engine-lab/probe.mjs               # uses the example FEN, full strength

import { Engine, toWhiteCp, applyUci } from './driver.mjs';

const a = process.argv.slice(2);
const fen = (a[0] && !a[0].startsWith('--')) ? a[0] : 'rq2k2r/1p3ppp/5n2/pQ1pn3/P7/4PNP1/1P1N1PP1/R1R3K1 w - - 0 1';
const opt = (f, d) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : d; };
const elo = opt('--elo', null);
const skill = opt('--skill', null);
const hash = opt('--hash', '4');
const movetime = Number(opt('--movetime', '1500'));

async function main() {
  const sub = new Engine();
  await sub.uci();
  sub.setoption('Hash', hash); sub.setoption('Threads', 1); sub.setoption('MultiPV', 1);
  if (elo != null) { sub.setoption('UCI_LimitStrength', 'true'); sub.setoption('UCI_Elo', elo); }
  else sub.setoption('UCI_LimitStrength', 'false');
  if (skill != null) sub.setoption('Skill Level', skill);
  await sub.isready();

  const ref = new Engine();
  await ref.uci();
  ref.setoption('Hash', 64); ref.setoption('Threads', 1); ref.setoption('UCI_LimitStrength', 'false');
  await ref.isready();

  console.log(`\nFEN: ${fen}`);
  console.log(`Config: ${elo != null ? `Elo ${elo}` : 'full strength'}${skill != null ? ` skill ${skill}` : ''}, hash ${hash}, ${movetime}ms\n`);

  const played = await sub.go(fen, `movetime ${movetime}`);
  if (!played.bestmove) {
    console.log('Subject returned no move (bestmove (none)) — the FEN is illegal or terminal.\n');
    sub.quit(); ref.quit(); return;
  }
  const refBefore = await refEval(ref, fen);
  const after = await applyUci(fen, played.bestmove);
  const refAfter = after.over ? refBefore : await refEval(ref, after.fen);
  const moverIsWhite = fen.split(' ')[1] === 'w';
  const cpl = Math.max(0, moverIsWhite ? refBefore.evalWhite - refAfter.evalWhite : refAfter.evalWhite - refBefore.evalWhite);

  console.log(`Subject played : ${after.san}  (${played.bestmove})   depth ${played.depth}, ${Math.round((played.nps||0)/1000)}k nps`);
  console.log(`Referee best   : ${refBefore.best}   eval ${fmt(refBefore.evalWhite)} (White POV)`);
  console.log(`Eval after move: ${fmt(refAfter.evalWhite)} (White POV)`);
  console.log(`Centipawn loss : ${Math.round(cpl)}  ${cpl < 30 ? '✓ fine' : cpl < 100 ? '~ inaccuracy' : '✗ weak move'}\n`);

  sub.quit(); ref.quit();
}

async function refEval(ref, fen) {
  await ref.newgame();
  const r = await ref.go(fen, 'movetime 2500');
  return { evalWhite: r.scoreCp == null ? 0 : toWhiteCp(r.scoreCp, fen), best: r.bestmove };
}
const fmt = (cp) => (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
main().catch((e) => { console.error(e); process.exit(1); });
