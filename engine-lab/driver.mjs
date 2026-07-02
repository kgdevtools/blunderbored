// A tiny UCI driver that talks to the EXACT same engine binary the app ships
// (public/engine/stockfish-18-lite-single.js, single-threaded WASM Lite) by
// spawning it as a node child process and speaking UCI over stdin/stdout.
//
// Everything here mirrors how lib/engine.ts drives the engine, so any weakness
// we measure is apples-to-apples with the app.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ENGINE_PATH = resolve(__dirname, '../public/engine/stockfish-18-lite-single.js');

export class Engine {
  constructor({ debug = false } = {}) {
    this.debug = debug;
    this.proc = spawn('node', [ENGINE_PATH], { cwd: resolve(__dirname, '..') });
    this.buf = '';
    this.listeners = []; // { test(line), onLine(line), done() }
    this.proc.stdout.on('data', (d) => this._ingest(d.toString()));
    this.proc.stderr.on('data', (d) => { if (this.debug) process.stderr.write(d); });
  }

  _ingest(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      if (this.debug) console.log('  <', line);
      for (const l of this.listeners) l.onLine(line);
    }
  }

  send(cmd) {
    if (this.debug) console.log('  >', cmd);
    this.proc.stdin.write(cmd + '\n');
  }

  // Resolve once a line satisfying `match` arrives; collect every line meanwhile.
  _await(match, { collect } = {}) {
    return new Promise((res) => {
      const collected = [];
      const l = {
        onLine: (line) => {
          if (collect && collect(line)) collected.push(line);
          if (match(line)) {
            this.listeners = this.listeners.filter((x) => x !== l);
            res({ line, collected });
          }
        },
      };
      this.listeners.push(l);
    });
  }

  async uci() { this.send('uci'); await this._await((l) => l === 'uciok'); }
  async isready() { this.send('isready'); await this._await((l) => l === 'readyok'); }
  async newgame() { this.send('ucinewgame'); await this.isready(); }

  setoption(name, value) { this.send(`setoption name ${name} value ${value}`); }

  // Search the given FEN and return the bestmove + the final info line's score
  // (centipawns, side-to-move POV) and depth. `go` is e.g. "movetime 1000" or
  // "depth 18".
  async go(fen, goCmd) {
    this.send(`position fen ${fen}`);
    this.send(`go ${goCmd}`);
    let lastInfo = null;
    const { line, collected } = await this._await(
      (l) => l.startsWith('bestmove'),
      { collect: (l) => l.startsWith('info ') && l.includes(' score ') && l.includes(' pv ') },
    );
    lastInfo = collected[collected.length - 1] ?? null;
    const bestmove = line.split(/\s+/)[1] ?? null;
    const parsed = lastInfo ? parseInfo(lastInfo) : { scoreCp: null, mate: null, depth: null, nodes: null, nps: null, pv: [] };
    return { bestmove: bestmove === '(none)' ? null : bestmove, ...parsed };
  }

  // Multi-PV search: returns the final info line per multipv rank, sorted best
  // first, as { rank, scoreCp (side-to-move POV), pv[] }.
  async goMulti(fen, goCmd) {
    this.send(`position fen ${fen}`);
    this.send(`go ${goCmd}`);
    const byRank = new Map();
    await this._await(
      (l) => l.startsWith('bestmove'),
      { collect: (l) => {
        if (!(l.startsWith('info ') && l.includes(' score ') && l.includes(' pv '))) return false;
        const p = l.split(/\s+/);
        const mi = p.indexOf('multipv');
        const rank = mi >= 0 ? +p[mi + 1] : 1;
        byRank.set(rank, parseInfo(l));
        return false;
      } },
    );
    return [...byRank.entries()].sort((a, b) => a[0] - b[0])
      .map(([rank, info]) => ({ rank, scoreCp: info.scoreCp, pv: info.pv }));
  }

  quit() { try { this.send('quit'); } catch {} this.proc.kill('SIGKILL'); }
}

function parseInfo(line) {
  const p = line.split(/\s+/);
  let scoreCp = null, mate = null, depth = null, nodes = null, nps = null, pv = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 'depth') depth = +p[i + 1];
    else if (p[i] === 'nodes') nodes = +p[i + 1];
    else if (p[i] === 'nps') nps = +p[i + 1];
    else if (p[i] === 'score') {
      if (p[i + 1] === 'cp') { scoreCp = +p[i + 2]; mate = null; }
      else if (p[i + 1] === 'mate') { mate = +p[i + 2]; scoreCp = mate > 0 ? 100000 - mate : -100000 - mate; }
    } else if (p[i] === 'pv') { pv = p.slice(i + 1); break; }
  }
  return { scoreCp, mate, depth, nodes, nps, pv };
}

// Side-to-move cp → White-POV cp (mirrors lib/blunder.ts toWhiteCp).
export function toWhiteCp(scoreCp, fen) {
  return fen.split(' ')[1] === 'b' ? -scoreCp : scoreCp;
}

// Apply a UCI move to a FEN using chess.js (already a dep of the app).
export async function applyUci(fen, uci) {
  const { Chess } = await import('chess.js');
  const c = new Chess(fen);
  const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return { fen: c.fen(), san: mv?.san ?? uci, over: c.isGameOver() };
}
