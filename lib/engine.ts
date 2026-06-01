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

class EngineService {
  private worker: Worker | null = null;
  private isReady = false;
  private readyResolve!: () => void;
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

  private currentEvalFen = '';

  // When cancel() sends 'stop' while a search is running, the engine will
  // still reply with a 'bestmove'. This flag tells parseLine to eat that
  // response instead of resolving the next evaluation's promise.
  private skipNextBestmove = false;

  constructor() {
    this.initReadyPromise();
  }

  private initReadyPromise() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  private get isBusy(): boolean {
    return this.currentResolve !== null || this.currentMultiResolve !== null;
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
    this.worker = new Worker('/engine/stockfish-18-lite-single.js');

    this.worker.onmessage = (e: MessageEvent) => {
      const line: string = String(e.data).trim();
      if (!line) return;
      if (line === 'uciok') {
        // Keep the hash table small so the WASM module doesn't OOM on deep searches.
        this.send('setoption name Hash value 4');
        this.send('isready');
        return;
      }
      if (line === 'readyok') { this.isReady = true; this.readyResolve(); return; }
      this.parseLine(line);
    };

    this.worker.onerror = (e: ErrorEvent) => {
      console.error('[Stockfish] Worker error:', e.message, e);
      // Reject pending promises so callers don't hang.
      this.currentReject?.(new Error('Stockfish worker crashed'));
      this.currentMultiReject?.(new Error('Stockfish worker crashed'));
      this.worker = null;
      this.isReady = false;
      this.currentResolve = null;
      this.currentReject = null;
      this.currentMultiResolve = null;
      this.currentMultiReject = null;
      this.latestInfo = null;
      this.multiLines.clear();
      this.skipNextBestmove = false;
    };

    this.send('uci');
    await this.readyPromise;
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
    this.latestInfo = null;
    this.multiLines.clear();
    this.currentMultiCount = 0;
  }

  async evaluateMulti(fen: string, depth = 18, pvCount = 3): Promise<EngineMultiLine[]> {
    const cacheKey = `${fen}:${pvCount}`;
    if (this.multiCache.has(cacheKey)) return this.multiCache.get(cacheKey)!;
    if (!this.worker || !this.isReady) await this.initialize();
    await this.waitIfBusy();

    this.currentEvalFen = fen;
    this.currentMultiCount = pvCount;
    return new Promise<EngineMultiLine[]>((resolve, reject) => {
      this.currentMultiResolve = resolve;
      this.currentMultiReject = reject;
      this.multiLines.clear();
      // No 'stop' here — cancel() already sent it and set skipNextBestmove.
      this.send(`setoption name MultiPV value ${pvCount}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }
}

export const engineService = new EngineService();
