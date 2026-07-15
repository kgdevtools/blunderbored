// lib/engine.ts — serialized job-queue wrapper around the Stockfish worker.
//
// Every search is a Job in a FIFO queue; exactly one job owns the worker at a
// time and every `bestmove` line is attributed to that job — nothing is ever
// "skipped", so a stale reply can't resolve the wrong promise (the v1
// `skipNextBestmove` flag could eat the NEXT search's bestmove and hang the
// whole service behind a promise that never settled).
//
// Cancellation is a stop-barrier: `stop` is sent, the job stays active until
// its bestmove ack arrives, and only then does the next job start. If the
// engine goes silent, a watchdog terminates and respawns the worker and the
// queue continues — callers see one rejected promise, never a dead engine.

export type EngineEvaluation = {
  depth: number;
  score: number;        // centipawns from White's perspective
  mate: number | null;  // mate in X (null if not mate)
  pv: string[];
};

export type EngineMultiLine = {
  rank: number;         // 1 = best, 2 = second-best, …
  score: number;        // centipawns from the side-to-move's perspective (UCI)
  mate: number | null;
  depth: number;
  pv: string[];         // UCI move sequence
};

const HANDSHAKE_TIMEOUT_MS = 12_000; // uci → readyok
const SILENCE_MS = 12_000;           // no output from a running job → restart
const STOP_GRACE_MS = 3_000;         // no bestmove after a stop → restart
const IDLE_TEARDOWN_MS = 5 * 60_000; // no jobs for this long → free the wasm memory

type JobKind = 'search' | 'bestmove' | 'sync';

interface Job {
  id: number;
  kind: JobKind;
  label: string;             // telemetry: e.g. "eval d14 pv3", "play n50k"
  commands: string[];        // sent verbatim when the job starts
  pvCount: number;
  hardCapMs: number;         // absolute wall-time cap for this job
  cancelled: boolean;
  timedOut: boolean;         // watchdog hard-cap fired (reject message differs)
  stopSentAt: number;        // set when we send 'stop' for this job
  startedAt: number;
  lastOutputAt: number;
  lines: Map<number, EngineMultiLine>;
  latest: EngineMultiLine | null; // non-multipv info lines
  resolveSearch?: (lines: EngineMultiLine[]) => void;
  resolveBest?: (uci: string | null) => void;
  resolveSync?: () => void;
  reject: (err: Error) => void;
}

class EngineService {
  private worker: Worker | null = null;
  private isReady = false;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;
  private readyPromise: Promise<void> | null = null;

  private queue: Job[] = [];
  private active: Job | null = null;
  private nextId = 1;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Full-strength eval caches (position truths — survive ucinewgame).
  private multiCache = new Map<string, EngineMultiLine[]>();

  // Desired play strength for bestMove() (null = full strength). Options are
  // emitted per job, so changing this mid-search can't corrupt a running one.
  private desiredElo: number | null = null;

  // ── Worker lifecycle ─────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.worker && this.isReady) return;
    if (this.worker && this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyPromise.catch(() => {}); // avoid unhandled rejection with no awaiter
    this.isReady = false;

    try {
      this.worker = new Worker('/engine/stockfish-18-lite-single.js');
    } catch (err) {
      this.worker = null;
      this.readyPromise = null;
      throw err instanceof Error ? err : new Error('Failed to start engine worker');
    }

    this.worker.onmessage = (e: MessageEvent) => this.onLine(String(e.data).trim());
    this.worker.onerror = (e: ErrorEvent) => {
      this.restart(new Error(`worker error: ${e.message || 'unknown'}`));
    };

    console.info('[engine] starting worker…');
    this.send('uci');

    const timer = setTimeout(() => {
      if (!this.isReady) {
        this.readyReject(new Error('engine init timed out (no readyok)'));
        this.teardownWorker();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    try {
      await this.readyPromise;
      console.info('[engine] ready');
    } finally {
      clearTimeout(timer);
    }
  }

  // Terminates the worker and clears readiness — the next call respawns it.
  // Queued jobs are NOT rejected here; pump() re-initializes and continues.
  private teardownWorker(): void {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.isReady = false;
    this.readyPromise = null;
  }

  // Kill and respawn the worker after a fault. The active job is rejected;
  // queued jobs survive and continue on the fresh worker.
  private restart(err: Error): void {
    console.error(`[engine] restarting worker: ${err.message}`);
    const job = this.active;
    this.active = null;
    this.stopWatchdog();
    this.teardownWorker();
    job?.reject(err);
    void this.pump();
  }

  // Fully stop the engine (route leave / idle teardown). Active + queued jobs
  // are rejected; the next call after this respawns the worker from scratch.
  shutdown(): void {
    const err = new Error('engine shut down');
    const jobs = this.active ? [this.active, ...this.queue] : [...this.queue];
    this.active = null;
    this.queue = [];
    this.stopWatchdog();
    this.teardownWorker();
    for (const j of jobs) j.reject(err);
    if (jobs.length) console.info(`[engine] shutdown (${jobs.length} job(s) rejected)`);
    else console.info('[engine] shutdown');
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  // ── Line handling ────────────────────────────────────────────────────────

  private onLine(line: string): void {
    if (!line) return;

    // Handshake phase — no jobs run until readyok.
    if (!this.isReady) {
      if (line === 'uciok') {
        // Small hash so the WASM module doesn't OOM on deep searches.
        this.send('setoption name Hash value 4');
        this.send('isready');
      } else if (line === 'readyok') {
        this.isReady = true;
        this.readyResolve();
      }
      return;
    }

    const job = this.active;
    if (!job) return; // stray output between jobs — ignore
    job.lastOutputAt = Date.now();

    if (line === 'readyok') {
      if (job.kind === 'sync') this.complete(job, () => job.resolveSync?.());
      return;
    }

    if (line.startsWith('bestmove')) {
      const token = line.split(' ')[1];
      const uci = token && token !== '(none)' ? token : null;
      if (job.cancelled) {
        this.complete(job, () => job.reject(new Error(job.timedOut ? 'search exceeded time cap' : 'cancelled')));
      } else if (job.kind === 'bestmove') {
        this.complete(job, () => job.resolveBest?.(uci));
      } else {
        const lines = job.lines.size > 0
          ? Array.from(job.lines.values()).sort((a, b) => a.rank - b.rank)
          : job.latest ? [job.latest] : [];
        if (lines.length === 0) {
          this.complete(job, () => job.reject(new Error('search returned no lines')));
        } else {
          this.complete(job, () => job.resolveSearch?.(lines));
        }
      }
      return;
    }

    if (!line.includes('info') || !line.includes('score')) return;
    const parsed = parseInfoLine(line);
    if (!parsed) return;
    const { rank, entry } = parsed;
    if (rank !== undefined) job.lines.set(rank, entry);
    else job.latest = entry;
  }

  // Finish the active job (resolve or reject via `settle`) and start the next.
  private complete(job: Job, settle: () => void): void {
    const ms = Date.now() - job.startedAt;
    const depth = job.lines.get(1)?.depth ?? job.latest?.depth ?? 0;
    console.debug(`[engine] #${job.id} ${job.label} done in ${ms}ms d${depth}${job.cancelled ? ' (cancelled)' : ''} · queue ${this.queue.length}`);
    this.active = null;
    this.stopWatchdog();
    settle();
    if (this.queue.length === 0) this.scheduleIdleTeardown();
    void this.pump();
  }

  // ── Queue ────────────────────────────────────────────────────────────────

  private enqueue(job: Job): void {
    this.clearIdleTimer();
    this.queue.push(job);
    void this.pump();
  }

  // Idle teardown: a dormant worker holds tens of MB of wasm memory — free it
  // when nothing has run for a while. The next call transparently respawns.
  private scheduleIdleTeardown(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (!this.active && this.queue.length === 0 && this.worker) {
        console.info('[engine] idle — tearing worker down');
        this.teardownWorker();
      }
    }, IDLE_TEARDOWN_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  private pumping = false;
  private async pump(): Promise<void> {
    if (this.pumping || this.active || this.queue.length === 0) return;
    this.pumping = true;
    try {
      if (!this.worker || !this.isReady) await this.initialize();
    } catch (err) {
      // Worker won't start — fail the whole queue so callers can react.
      const e = err instanceof Error ? err : new Error('engine init failed');
      const jobs = this.queue;
      this.queue = [];
      for (const j of jobs) j.reject(e);
      this.pumping = false;
      return;
    }
    this.pumping = false;
    if (this.active || this.queue.length === 0) return;

    const job = this.queue.shift()!;
    this.active = job;
    job.startedAt = Date.now();
    job.lastOutputAt = job.startedAt;
    console.debug(`[engine] #${job.id} ${job.label} start · queue ${this.queue.length}`);
    for (const cmd of job.commands) this.send(cmd);
    this.startWatchdog();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      const job = this.active;
      if (!job) { this.stopWatchdog(); return; }
      const now = Date.now();
      if (job.stopSentAt && now - job.stopSentAt > STOP_GRACE_MS) {
        this.restart(new Error(`no bestmove ${STOP_GRACE_MS}ms after stop (#${job.id} ${job.label})`));
      } else if (now - job.lastOutputAt > SILENCE_MS) {
        this.restart(new Error(`engine silent ${SILENCE_MS}ms (#${job.id} ${job.label})`));
      } else if (now - job.startedAt > job.hardCapMs) {
        if (!job.stopSentAt) { job.cancelled = true; job.timedOut = true; job.stopSentAt = now; this.send('stop'); }
      }
    }, 500);
  }

  private stopWatchdog(): void {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  // Cancel the active job (stop-barrier: it completes on its bestmove ack) and
  // reject everything queued behind it.
  cancel(): void {
    for (const j of this.queue) j.reject(new Error('cancelled'));
    this.queue = [];
    const job = this.active;
    if (job && !job.cancelled) {
      job.cancelled = true;
      job.stopSentAt = Date.now();
      if (job.kind === 'sync') {
        // No bestmove will come for a sync job; just let it resolve on readyok.
        job.cancelled = false;
      } else {
        this.send('stop');
      }
    }
  }

  // ── Option plumbing ──────────────────────────────────────────────────────

  // Strength options are emitted as part of each job's command list (so a
  // strength change can never race a running search). This setter only records
  // the desired play strength used by bestMove().
  setStrength(elo: number | null): void {
    this.desiredElo = elo;
  }

  private strengthCommands(elo: number | null): string[] {
    if (elo === null) return ['setoption name UCI_LimitStrength value false'];
    return [
      'setoption name UCI_LimitStrength value true',
      `setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(elo)))}`,
    ];
  }

  // ── Public search API (unchanged signatures) ─────────────────────────────

  // Reset engine game state between challenges/games (clears TT heuristics
  // carried across unrelated positions). Resolves when the engine acks.
  newGame(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.enqueue({
        id: this.nextId++, kind: 'sync', label: 'ucinewgame',
        commands: ['ucinewgame', 'isready'],
        pvCount: 0, hardCapMs: 10_000, cancelled: false, timedOut: false, stopSentAt: 0,
        startedAt: 0, lastOutputAt: 0, lines: new Map(), latest: null,
        resolveSync: resolve, reject,
      });
    });
  }

  async evaluate(fen: string, depth = 18): Promise<EngineEvaluation> {
    const [top] = await this.evaluateMulti(fen, depth, 1);
    return { depth: top.depth, score: top.score, mate: top.mate, pv: top.pv };
  }

  // Full-strength fixed-depth multi-PV evaluation (cached).
  evaluateMulti(fen: string, depth = 18, pvCount = 3): Promise<EngineMultiLine[]> {
    // Depth is part of the key: the two-pass reviewer asks for the same FEN at
    // different depths, and a shallow pass-1 result must not satisfy the deep
    // pass (nor a later, deeper verification request).
    const cacheKey = `${fen}:${depth}:${pvCount}`;
    const hit = this.multiCache.get(cacheKey);
    if (hit) return Promise.resolve(hit);

    return new Promise<EngineMultiLine[]>((resolve, reject) => {
      this.enqueue({
        id: this.nextId++, kind: 'search', label: `eval d${depth} pv${pvCount}`,
        commands: [
          ...this.strengthCommands(null),
          `setoption name MultiPV value ${pvCount}`,
          `position fen ${fen}`,
          `go depth ${depth}`,
        ],
        pvCount, hardCapMs: 30_000, cancelled: false, timedOut: false, stopSentAt: 0,
        startedAt: 0, lastOutputAt: 0, lines: new Map(), latest: null,
        resolveSearch: (lines) => { this.multiCache.set(cacheKey, lines); resolve(lines); },
        reject,
      });
    });
  }

  // Play a single move with a time budget, honouring setStrength(). Resolves
  // with the chosen move in UCI, or null when there's no legal move.
  bestMove(fen: string, movetimeMs = 800): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      this.enqueue({
        id: this.nextId++, kind: 'bestmove', label: `best ${movetimeMs}ms`,
        commands: [
          ...this.strengthCommands(this.desiredElo),
          'setoption name MultiPV value 1',
          `position fen ${fen}`,
          `go movetime ${movetimeMs}`,
        ],
        pvCount: 1, hardCapMs: movetimeMs + 15_000, cancelled: false, timedOut: false, stopSentAt: 0,
        startedAt: 0, lastOutputAt: 0, lines: new Map(), latest: null,
        resolveBest: resolve, reject,
      });
    });
  }

  // Node-limited full-strength multi-PV search for *play* (the strength knob is
  // the node budget — see engine-lab/README.md). Not cached.
  searchNodes(fen: string, nodes: number, pvCount = 3): Promise<EngineMultiLine[]> {
    return new Promise<EngineMultiLine[]>((resolve, reject) => {
      this.enqueue({
        id: this.nextId++, kind: 'search', label: `play n${Math.round(nodes / 1000)}k pv${pvCount}`,
        commands: [
          ...this.strengthCommands(null),
          `setoption name MultiPV value ${pvCount}`,
          `position fen ${fen}`,
          `go nodes ${Math.max(1, Math.round(nodes))}`,
        ],
        pvCount, hardCapMs: 20_000, cancelled: false, timedOut: false, stopSentAt: 0,
        startedAt: 0, lastOutputAt: 0, lines: new Map(), latest: null,
        resolveSearch: resolve, reject,
      });
    });
  }
}

// info-line parser: extracts depth/score/pv (+ multipv rank when present).
function parseInfoLine(line: string): { rank: number | undefined; entry: EngineMultiLine } | null {
  const parts = line.split(' ');
  let depth: number | undefined;
  let score: number | undefined;
  let mate: number | null = null;
  let pv: string[] = [];
  let rank: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    switch (parts[i]) {
      case 'depth':
        depth = parseInt(parts[++i], 10);
        break;
      case 'multipv':
        rank = parseInt(parts[++i], 10);
        break;
      case 'score': {
        const type = parts[++i];
        if (type === 'cp') {
          score = parseInt(parts[++i], 10);
          mate = null;
        } else if (type === 'mate') {
          mate = parseInt(parts[++i], 10);
          score = mate > 0 ? 10000 : -10000;
        }
        break;
      }
      case 'pv':
        pv = parts.slice(i + 1);
        i = parts.length;
        break;
    }
  }

  if (depth === undefined || score === undefined) return null;
  return { rank, entry: { rank: rank ?? 1, score, mate, depth, pv } };
}

export const engineService = new EngineService();
