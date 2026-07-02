// Strength experiment: how much does each engine config actually cost us?
//
// Method (self-calibrating, no hand-keyed answers):
//   • A REFEREE engine runs at full strength, big hash, long time — this defines
//     "optimal" eval for each position and for the position after a played move.
//   • A SUBJECT engine plays each position under a given config (Elo limit, skill,
//     movetime, hash). We then ask the referee how much eval the subject threw
//     away vs optimal → centipawn loss (mover's POV). Lower = stronger.
//
// This directly answers: is the engine just weak, or is OUR config the problem?
// In particular it isolates whether UCI_LimitStrength ignores extra think-time
// (compare elo2250@500 vs elo2250@4000).

import { Engine, toWhiteCp, applyUci } from './driver.mjs';
import { POSITIONS } from './positions.mjs';

const args = process.argv.slice(2);
const REF_MS = num('--ref', 2500);          // referee think-time per eval
const onlyPos = str('--pos', null);         // run a single position id
const withSkill = args.includes('--skill'); // include Skill Level configs

// The app's real strength mapping (mirrors engineMovetime() in BlunderableShell).
const movetimeFor = (elo) => Math.round(500 + Math.min(1, Math.max(0, (elo - 1350) / 1250)) * 3000);

const CONFIGS = [
  { id: 'full@800',      movetime: 800 },                                   // full strength, app's old flat budget
  { id: 'full@2600',     movetime: 2600 },                                  // full strength, generous time
  { id: 'elo1350',       elo: 1350, movetime: movetimeFor(1350) },          // ── app's rating-limited play ──
  { id: 'elo1800',       elo: 1800, movetime: movetimeFor(1800) },
  { id: 'elo2250',       elo: 2250, movetime: movetimeFor(2250) },
  { id: 'elo2600',       elo: 2600, movetime: movetimeFor(2600) },
  { id: 'elo2250@500',   elo: 2250, movetime: 500 },                        // ── does time help under the limit? ──
  { id: 'elo2250@4000',  elo: 2250, movetime: 4000 },
  ...(withSkill ? [
    { id: 'skill5@1500',  skill: 5,  movetime: 1500 },
    { id: 'skill10@1500', skill: 10, movetime: 1500 },
    { id: 'skill15@1500', skill: 15, movetime: 1500 },
    { id: 'skill20@1500', skill: 20, movetime: 1500 },
  ] : []),
  // Pure depth-limiting: full-strength move choice but a shallow search. Weakens
  // the engine WITHOUT the random blunder injection of UCI_LimitStrength.
  ...(args.includes('--depth') ? [
    { id: 'depth6',  go: 'depth 6' },
    { id: 'depth8',  go: 'depth 8' },
    { id: 'depth10', go: 'depth 10' },
    { id: 'depth12', go: 'depth 12' },
  ] : []),
];

const positions = onlyPos ? POSITIONS.filter((p) => p.id === onlyPos) : POSITIONS;

function num(flag, def) { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : def; }
function str(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

async function makeReferee() {
  const e = new Engine();
  await e.uci();
  e.setoption('Hash', 64);
  e.setoption('Threads', 1);
  e.setoption('MultiPV', 1);
  e.setoption('UCI_LimitStrength', 'false');
  e.setoption('Skill Level', 20);
  await e.isready();
  return e;
}

// Referee: White-POV eval of a position + its best move, at full strength.
async function refEval(ref, fen) {
  await ref.newgame();
  const r = await ref.go(fen, `movetime ${REF_MS}`);
  return { evalWhite: r.scoreCp == null ? 0 : toWhiteCp(r.scoreCp, fen), best: r.bestmove, depth: r.depth };
}

async function applyConfig(sub, cfg) {
  await sub.newgame();
  sub.setoption('Hash', cfg.hash ?? 4);        // app uses Hash 4 — replicate by default
  sub.setoption('Threads', 1);
  sub.setoption('MultiPV', 1);
  if (cfg.elo != null) {
    sub.setoption('UCI_LimitStrength', 'true');
    sub.setoption('UCI_Elo', Math.max(1320, Math.min(3190, cfg.elo)));
  } else {
    sub.setoption('UCI_LimitStrength', 'false');
  }
  if (cfg.skill != null) sub.setoption('Skill Level', cfg.skill);
  await sub.isready();
}

function loss(moverIsWhite, bestWhite, afterWhite) {
  const l = moverIsWhite ? bestWhite - afterWhite : afterWhite - bestWhite;
  return Math.max(0, l);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  console.log(`\nReferee: full strength, Hash 64, ${REF_MS}ms/eval. Subject: Hash 4 (app default).`);
  console.log(`Positions: ${positions.length}   Configs: ${CONFIGS.length}\n`);

  const ref = await makeReferee();
  const sub = new Engine();
  await sub.uci(); await sub.isready();

  // Ground truth per position.
  const gt = new Map();
  for (const p of positions) {
    const g = await refEval(ref, p.fen);
    if (!g.best) { console.log(`gt ${p.id.padEnd(10)} SKIPPED (no legal best — illegal/terminal FEN)`); continue; }
    gt.set(p.id, g);
    console.log(`gt ${p.id.padEnd(10)} best ${String(g.best).padEnd(6)} eval ${fmt(g.evalWhite)} (d${g.depth})`);
  }
  const live = positions.filter((p) => gt.has(p.id));
  console.log('');

  const results = new Map(CONFIGS.map((c) => [c.id, []]));
  const npsByCfg = new Map(CONFIGS.map((c) => [c.id, []]));
  const matchByCfg = new Map(CONFIGS.map((c) => [c.id, 0]));

  for (const p of live) {
    const moverIsWhite = p.fen.split(' ')[1] === 'w';
    const g = gt.get(p.id);
    for (const cfg of CONFIGS) {
      await applyConfig(sub, cfg);
      const played = await sub.go(p.fen, cfg.go ?? `movetime ${cfg.movetime}`);
      if (played.nps) npsByCfg.get(cfg.id).push(played.nps);
      if (!played.bestmove) { results.get(cfg.id).push(0); continue; }
      if (played.bestmove === g.best) matchByCfg.set(cfg.id, matchByCfg.get(cfg.id) + 1);
      const after = await applyUci(p.fen, played.bestmove);
      const av = after.over ? g.evalWhite : (await refEval(ref, after.fen)).evalWhite;
      const cpl = loss(moverIsWhite, g.evalWhite, av);
      results.get(cfg.id).push(cpl);
    }
    process.stdout.write(`· ${p.id} done\n`);
  }

  console.log('\n┌─ Centipawn loss vs optimal (lower = stronger) ─────────────────────────────┐');
  console.log('config           avg cpl   median   matchBest   avg knps   movetime');
  console.log('────────────────────────────────────────────────────────────────────────────');
  for (const cfg of CONFIGS) {
    const losses = results.get(cfg.id);
    const knps = Math.round(mean(npsByCfg.get(cfg.id)) / 1000);
    const match = `${matchByCfg.get(cfg.id)}/${live.length}`;
    console.log(
      cfg.id.padEnd(16) +
      String(Math.round(mean(losses))).padStart(6) + '   ' +
      String(Math.round(median(losses))).padStart(6) + '   ' +
      match.padStart(8) + '   ' +
      String(knps).padStart(7) + '   ' +
      (cfg.go ?? `${cfg.movetime}ms`).padStart(8),
    );
  }
  console.log('└────────────────────────────────────────────────────────────────────────────┘');
  console.log('\nRead: if elo2250@500 ≈ elo2250@4000, UCI_LimitStrength ignores think-time.');
  console.log('If full@* cpl ≪ elo* cpl, the weakness is the strength limiter, not the binary.\n');

  ref.quit(); sub.quit();
}

const fmt = (cp) => (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
main().catch((e) => { console.error(e); process.exit(1); });
