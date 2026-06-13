// lib/engine.ts

export type EngineEvaluation = {
  depth: number;
  score: number;        // centipawns from White's perspective
  mate: number | null;  // mate in X (null if not mate)
  pv: string[];
};

export type EngineMultiLine = {
  rank: number;         // 1 = best, 2 = second-best, 3 = third-best
  score: number;        // centipawns from White's perspective
  mate: number | null;
  depth: number;
  pv: string[];         // UCI move sequence
};

// If the wasm handshake or a search doesn't finish within these bounds we give
// up and reject, instead of leaving callers hung on a stalled worker (seen on
// low-memory mobile devices where the single-threaded build can stall).
const HANDSHAKE_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 25_000;

class EngineService {
  private worker: Worker | null = null;
  private isReady = false;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;
  private readyPromise!: Promise<void>;

  // Single-PV state
  private cache = new Map<string, EngineEvaluation>();
  private currentResolve: ((result: EngineEvaluation) => void) | null = null;
  private currentReject: ((err: Error) => void) | null = null;
  private latestInfo: EngineEvaluation | null = null;

  // Multi-PV state
  private multiCache = new Map<string, EngineMultiLine[]>();
  private currentMultiResolve: ((result: EngineMultiLine[]) => void) | null = null;
  private currentMultiReject: ((err: Error) => void) | null = null;
  private multiLines = new Map<number, EngineMultiLine>();
  private currentMultiCount = 0;

  // Best-move (move-by-move play) state — resolves on the `bestmove` line itself
  // rather than from accumulated info, so it's immune to the multipv routing.
  private currentBestResolve: ((uci: string | null) => void) | null = null;
  private currentBestReject: ((err: Error) => void) | null = null;

  // Last strength applied, so we don't re-send identical setoptions every move.
  private appliedElo: number | null | undefined = undefined;

  private currentEvalFen = '';

  // When cancel() sends 'stop' while a search is running, the engine will
  // still reply with a 'bestmove'. This flag tells parseLine to eat that
  // response instead of resolving the next evaluation's promise.
  private skipNextBestmove = false;

  constructor() {
    this.initReadyPromise();
  }

  private initReadyPromise() {
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Guard against an unhandled rejection if readyReject fires with no awaiter.
    this.readyPromise.catch(() => {});
  }

  // Tears the engine down and rejects every pending promise so callers fail
  // fast instead of hanging. Nulling the worker means the next call retries.
  private failEngine(err: Error) {
    console.error('[Stockfish]', err.message);
    this.readyReject?.(err);
    this.currentReject?.(err);
    this.currentMultiReject?.(err);
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.currentResolve = null;
    this.currentReject = null;
    this.currentMultiResolve = null;
    this.currentMultiReject = null;
    this.currentBestResolve = null;
    this.currentBestReject?.(err);
    this.currentBestReject = null;
    this.latestInfo = null;
    this.multiLines.clear();
    this.currentMultiCount = 0;
    this.skipNextBestmove = false;
    this.appliedElo = undefined;
  }

  private get isBusy(): boolean {
    return this.currentResolve !== null || this.currentMultiResolve !== null || this.currentBestResolve !== null;
  }

  async initialize(): Promise<void> {
    if (this.worker && this.isReady) return;
    if (this.worker) {
      // Worker exists but not yet ready — wait for the existing handshake.
      await this.readyPromise;
      return;
    }

    this.initReadyPromise();
    this.isReady = false;

    try {
      this.worker = new Worker('/engine/stockfish-18-lite-single.js');
    } catch (err) {
      this.worker = null;
      throw err instanceof Error ? err : new Error('Failed to start engine worker');
    }

    this.worker.onmessage = (e: MessageEvent) => {
      const line: string = String(e.data).trim();
      if (!line) return;
      if (line === 'uciok') {
        // Keep the hash table small so the WASM module doesn't OOM on deep searches.
        this.send('setoption name Hash value 4');
        this.send('isready');
        return;
      }
      if (line === 'readyok') {
        this.isReady = true;
        console.info('[Stockfish] engine ready');
        this.readyResolve();
        return;
      }
      this.parseLine(line);
    };

    this.worker.onerror = (e: ErrorEvent) => {
      this.failEngine(new Error(`Stockfish worker error: ${e.message || 'unknown'}`));
    };

    console.info('[Stockfish] starting engine…');
    this.send('uci');

    // Don't await forever: if the wasm never reports readyok, reject so the
    // caller (and the UI) can recover instead of showing "Analysing…" endlessly.
    const timer = setTimeout(() => {
      if (!this.isReady) this.failEngine(new Error('Engine init timed out (no readyok)'));
    }, HANDSHAKE_TIMEOUT_MS);

    try {
      await this.readyPromise;
    } finally {
      clearTimeout(timer);
    }
  }

  private send(cmd: string) {
    if (!this.worker) return;
    this.worker.postMessage(cmd);
  }

  private parseLine(line: string) {
    if (line.startsWith('bestmove')) {
      // Eat the reply from a stop sent by cancel() so it doesn't resolve the
      // next evaluation's promise prematurely.
      if (this.skipNextBestmove) {
        this.skipNextBestmove = false;
        return;
      }

      // Move-by-move play: the move is on the bestmove line itself.
      if (this.currentBestResolve) {
        const token = line.split(' ')[1];
        const resolve = this.currentBestResolve;
        this.currentBestResolve = null;
        this.currentBestReject = null;
        resolve(token && token !== '(none)' ? token : null);
        return;
      }

      if (this.currentMultiResolve) {
        const lines = Array.from(this.multiLines.values()).sort((a, b) => a.rank - b.rank);
        this.multiCache.set(`${this.currentEvalFen}:${this.currentMultiCount}`, lines);
        this.currentMultiResolve(lines);
        this.currentMultiResolve = null;
        this.currentMultiReject = null;
        this.multiLines.clear();
        this.currentMultiCount = 0;
      } else if (this.currentResolve && this.latestInfo) {
        this.cache.set(this.currentEvalFen, this.latestInfo);
        this.currentResolve(this.latestInfo);
        this.currentResolve = null;
        this.currentReject = null;
        this.latestInfo = null;
      }
      return;
    }

    if (!line.includes('info') || !line.includes('score')) return;

    const parts = line.split(' ');
    let depth: number | undefined;
    let score: number | undefined;
    let mate: number | null = null;
    let pv: string[] = [];
    let multipvRank: number | undefined;

    for (let i = 0; i < parts.length; i++) {
      switch (parts[i]) {
        case 'depth':
          depth = parseInt(parts[++i], 10);
          break;
        case 'multipv':
          multipvRank = parseInt(parts[++i], 10);
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

    if (depth === undefined || score === undefined) return;

    if (multipvRank !== undefined) {
      this.multiLines.set(multipvRank, { rank: multipvRank, score, mate, depth, pv });
    } else {
      this.latestInfo = { depth, score, mate, pv };
    }
  }

  private async waitIfBusy(): Promise<void> {
    if (!this.isBusy) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!this.isBusy) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }

  async evaluate(fen: string, depth = 18): Promise<EngineEvaluation> {
    if (this.cache.has(fen)) return this.cache.get(fen)!;
    if (!this.worker || !this.isReady) await this.initialize();
    await this.waitIfBusy();

    this.currentEvalFen = fen;
    return new Promise<EngineEvaluation>((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      this.latestInfo = null;
      this.send('setoption name MultiPV value 1');
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  cancel(): void {
    if (!this.isBusy) return;
    // Mark that the engine's bestmove reply to this stop should be discarded.
    this.skipNextBestmove = true;
    this.send('stop');
    this.currentResolve = null;
    this.currentReject = null;
    this.currentMultiResolve = null;
    this.currentMultiReject = null;
    this.currentBestResolve = null;
    this.currentBestReject = null;
    this.latestInfo = null;
    this.multiLines.clear();
    this.currentMultiCount = 0;
  }

  // Set the engine's playing strength for subsequent *play* (bestMove) calls.
  // `elo` = null → full strength (used for scoring/eval so blunder detection stays
  // accurate). A number → UCI_LimitStrength at that Elo (engine floor ≈ 1320).
  // Idempotent: skips re-sending if the strength is unchanged.
  setStrength(elo: number | null): void {
    if (this.appliedElo === elo) return;
    this.appliedElo = elo;
    if (elo === null) {
      this.send('setoption name UCI_LimitStrength value false');
    } else {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, Math.round(elo)))}`);
    }
  }

  // Play a single move with a fixed time budget (`go movetime`). Resolves with the
  // chosen move in UCI (e.g. "e2e4"), or null if there's no legal move. Honours the
  // strength set via setStrength(). Immune to the multipv routing bug because it
  // reads the move straight off the bestmove line.
  async bestMove(fen: string, movetimeMs = 800): Promise<string | null> {
    if (!this.worker || !this.isReady) await this.initialize();
    await this.waitIfBusy();

    this.currentEvalFen = fen;
    return new Promise<string | null>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.send('stop');
        this.skipNextBestmove = true;
        this.currentBestResolve = null;
        this.currentBestReject = null;
        reject(new Error('Engine move timed out'));
      }, movetimeMs + SEARCH_TIMEOUT_MS);

      this.currentBestResolve = (uci) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(uci);
      };
      this.currentBestReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      this.send('setoption name MultiPV value 1');
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetimeMs}`);
    });
  }

  async evaluateMulti(fen: string, depth = 18, pvCount = 3): Promise<EngineMultiLine[]> {
    const cacheKey = `${fen}:${pvCount}`;
    if (this.multiCache.has(cacheKey)) return this.multiCache.get(cacheKey)!;
    if (!this.worker || !this.isReady) await this.initialize();
    await this.waitIfBusy();

    this.currentEvalFen = fen;
    this.currentMultiCount = pvCount;
    return new Promise<EngineMultiLine[]>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.error('[Stockfish] search timed out at depth', depth);
        this.send('stop');
        this.skipNextBestmove = true;
        this.currentMultiResolve = null;
        this.currentMultiReject = null;
        this.multiLines.clear();
        this.currentMultiCount = 0;
        reject(new Error('Engine search timed out'));
      }, SEARCH_TIMEOUT_MS);

      this.currentMultiResolve = (lines) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(lines);
      };
      this.currentMultiReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      this.multiLines.clear();
      // No 'stop' here — cancel() already sent it and set skipNextBestmove.
      this.send(`setoption name MultiPV value ${pvCount}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  // Node-limited multi-PV search for *play*. Returns the top `pvCount` lines
  // (scores in side-to-move POV) so the caller can sample a move. We weaken the
  // engine purely by capping nodes (full-strength move choice, just less search)
  // rather than UCI_LimitStrength, whose random move-sampling plays erratically.
  // Not cached: the budget is the strength knob and callers may re-search.
  async searchNodes(fen: string, nodes: number, pvCount = 3): Promise<EngineMultiLine[]> {
    if (!this.worker || !this.isReady) await this.initialize();
    // Ensure the strength limiter is off — play strength comes from the node cap.
    this.setStrength(null);
    await this.waitIfBusy();

    this.currentEvalFen = fen;
    this.currentMultiCount = pvCount;
    return new Promise<EngineMultiLine[]>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.send('stop');
        this.skipNextBestmove = true;
        this.currentMultiResolve = null;
        this.currentMultiReject = null;
        this.multiLines.clear();
        this.currentMultiCount = 0;
        reject(new Error('Engine node search timed out'));
      }, SEARCH_TIMEOUT_MS);

      this.currentMultiResolve = (lines) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(lines);
      };
      this.currentMultiReject = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      this.multiLines.clear();
      this.send(`setoption name MultiPV value ${pvCount}`);
      this.send(`position fen ${fen}`);
      this.send(`go nodes ${Math.max(1, Math.round(nodes))}`);
    });
  }
}

export const engineService = new EngineService();
