'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { sanitizePgn, normalizeFen } from '@/lib/gameTree';
import { engineService } from '@/lib/engine';
import { saveChallenge, useRecentChallenges } from '@/lib/challenges';
import { BoardEditor } from './BoardEditor';
import { GameMovesList, type Ply } from './GameMovesList';
import { SavePositionDialog, SavedPositionsList, type SavePositionInput } from './SavedPositions';
import { recordPractice } from '@/lib/positions';
import { db, type SavedPosition } from '@/lib/db';
import { moveAccuracy } from '@/lib/accuracy';
import {
  toWhiteCp, evalForSide, classifySelfLoss, winPForPlayer, detectThreats, THREAT_COLORS,
  moveNotation, CLASS_META, CUMULATIVE_FAIL_WP, classifyMoveTime, TIME_META,
  type MoveClass, type BlunderMove,
} from '@/lib/blunder';

const ENGINE_DEPTH = 12;            // scoring search depth (full strength)
const EVAL_TIMEOUT_MS = 12_000;     // client cap so a slow scoring search can't hang the UI

type Status = 'init' | 'ready' | 'player' | 'thinking' | 'failed' | 'succeeded' | 'error';
type EndReason = 'blunder' | 'drift' | 'flagged' | 'target' | 'mate';
type Side = 'w' | 'b';
type Phase = 'setup' | 'playing';

interface Config {
  side: Side; fen: string; target: number;
  ratingElo: number; clockInitialMs: number; clockIncMs: number;
  savedPositionId?: string; // set when launched from a saved position (for practice stats)
}

const useMeasureEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const TARGET_MIN = 3, TARGET_MAX = 10;
const RATING_MIN = 1350, RATING_MAX = 2600;
const CLOCK_PRESETS_MIN = [3, 5, 10];
const INC_PRESETS_S = [0, 2, 5];

// ── Play strength model ───────────────────────────────────────────────────────
// The engine-lab harness showed UCI_LimitStrength plays *erratically* (it hits a
// rating by randomly sampling weak moves), so we weaken on our terms instead:
//   • node cap  → full-strength choice, just less search (consistent ceiling)
//   • top-K softmax sampling → plausible, bounded inaccuracies that scale with
//     rating (never a random blunder in a quiet position)
// See engine-lab/README.md for the data behind these curves.
const PLAY_MULTIPV = 4;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Node budget: ~50k at 1350 up to ~1M at 2600 (geometric). Caps how deep it sees.
function ratingToNodes(elo: number): number {
  const t = clamp01((elo - RATING_MIN) / (RATING_MAX - RATING_MIN));
  return Math.round(50_000 * Math.pow(20, t));
}

// Sampling temperature (centipawns): high at low ratings (flatter → more likely
// to pick a worse top-4 move), → near-zero at the top (always best).
function ratingToTempCp(elo: number): number {
  const t = clamp01((elo - RATING_MIN) / (RATING_MAX - RATING_MIN));
  return Math.round(140 - t * 134); // 140 … 6
}

// Softmax-sample a move from the top lines by their (side-to-move POV) score.
// tempCp≈0 ⇒ always the best line; larger ⇒ flatter distribution.
function sampleMove(lines: { score: number; pv: string[] }[], tempCp: number): string | null {
  if (lines.length === 0) return null;
  if (tempCp <= 1) return lines[0].pv[0] ?? null;
  const best = lines[0].score;
  const weights = lines.map((l) => Math.exp((l.score - best) / tempCp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lines.length; i++) { r -= weights[i]; if (r <= 0) return lines[i].pv[0] ?? null; }
  return lines[0].pv[0] ?? null;
}

// A realistic middlegame default — you'll usually practise from positions already
// underway (Giuoco Pianissimo, both sides developed and castled).
const DEFAULT_FEN = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7';

function ratingLabel(elo: number): string {
  if (elo < 1500) return 'Casual';
  if (elo < 1900) return 'Club';
  if (elo < 2200) return 'Strong';
  return 'Expert';
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// ─── Setup screen ───────────────────────────────────────────────────────────

// A FEN's first token is the piece placement: 8 ranks joined by '/'. Anything
// else (move text, headers) we treat as PGN.
function looksLikeFen(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? '';
  return first.split('/').length === 8;
}

function SetupScreen({ onStart, initialPositionId }: { onStart: (cfg: Config) => void; initialPositionId?: string }) {
  const [side, setSide] = useState<Side>('w');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fen, setFen] = useState(DEFAULT_FEN);
  const [raw, setRaw] = useState(DEFAULT_FEN);   // the combined FEN/PGN input box
  const [target, setTarget] = useState(5);
  const [ratingElo, setRatingElo] = useState(1600);
  const [clockMin, setClockMin] = useState(5);
  const [incS, setIncS] = useState(2);
  const [inputErr, setInputErr] = useState<string | null>(null);
  const [fenHist, setFenHist] = useState<string[]>([]);
  const [sanHist, setSanHist] = useState<string[]>([]);
  const [ply, setPly] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  // Links the form back to a loaded saved position (for practice stats) — cleared
  // the moment the position is edited away from.
  const [loadedPosId, setLoadedPosId] = useState<string | null>(null);
  const [loadedFen, setLoadedFen] = useState<string | null>(null);

  // Warm-start the engine the moment setup mounts so the load is done by Start.
  useEffect(() => { engineService.initialize().catch(() => {}); }, []);

  const pickSide = (s: Side) => { setSide(s); setOrientation(s === 'w' ? 'white' : 'black'); };

  // Board edits flow straight to the FEN and reset the input box to that FEN
  // (leaving any loaded PGN behind — you're now hand-editing a position).
  const onBoardFen = useCallback((f: string) => {
    setFen(f); setRaw(f); setError(null); setInputErr(null);
    setFenHist([]); setSanHist([]); setLoadedPosId(null);
  }, []);

  // Load a saved position into the form (prefills FEN + settings).
  const loadPosition = (p: SavedPosition) => {
    pickSide(p.side);
    setFen(p.fen); setRaw(p.fen); setFenHist([]); setSanHist([]); setError(null); setInputErr(null);
    if (p.target) setTarget(p.target);
    if (p.ratingElo) setRatingElo(p.ratingElo);
    if (p.clockInitialMs) setClockMin(Math.round(p.clockInitialMs / 60_000));
    if (p.clockIncMs != null) setIncS(Math.round(p.clockIncMs / 1000));
    setLoadedPosId(p.id); setLoadedFen(p.fen);
  };

  // Deep-link: /blunderable?pos=<id> preloads that saved position into the form.
  useEffect(() => {
    if (!initialPositionId) return;
    db.savedPositions.get(initialPositionId).then((p) => { if (p) loadPosition(p); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPositionId]);

  // Parse the combined box: auto-detect FEN vs PGN.
  const parseInput = (text: string) => {
    setInputErr(null); setLoadedPosId(null);
    const t = text.trim();
    if (!t) { setFenHist([]); setSanHist([]); return; }
    if (looksLikeFen(t)) {
      const n = normalizeFen(sanitizePgn(t));
      setFenHist([]); setSanHist([]); setFen(n); setError(null);
      return;
    }
    // Otherwise treat as PGN.
    try {
      const loader = new Chess();
      loader.loadPgn(sanitizePgn(t));
      const hist = loader.history({ verbose: true });
      if (hist.length === 0) { setInputErr('No moves or FEN found.'); return; }
      const fens = [hist[0].before, ...hist.map((m) => m.after)];
      setFenHist(fens); setSanHist(hist.map((m) => m.san));
      const last = fens.length - 1;
      setPly(last); setFen(fens[last]); setError(null);
    } catch {
      setInputErr('Not a valid FEN or PGN.');
      setFenHist([]); setSanHist([]);
    }
  };

  const gotoPly = (i: number) => {
    const clamped = Math.max(0, Math.min(fenHist.length - 1, i));
    setPly(clamped);
    setFen(fenHist[clamped]); setError(null);
  };

  const plyNav = fenHist.length > 1 ? {
    index: ply, count: fenHist.length - 1,
    label: ply > 0 ? `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'} ${sanHist[ply - 1]}` : 'start',
    goto: gotoPly,
  } : null;

  const start = () => {
    const clean = normalizeFen(sanitizePgn(fen)) || DEFAULT_FEN;
    try { new Chess(clean); } catch {
      setError('That position isn’t a legal FEN — fix it and try again.');
      return;
    }
    const savedPositionId = loadedPosId && clean === loadedFen ? loadedPosId : undefined;
    onStart({ side, fen: clean, target, ratingElo, clockInitialMs: clockMin * 60_000, clockIncMs: incS * 1000, savedPositionId });
  };

  const saveInput: SavePositionInput = {
    fen: normalizeFen(sanitizePgn(fen)) || fen, side,
    ratingElo, target, clockInitialMs: clockMin * 60_000, clockIncMs: incS * 1000, source: 'blunderable',
  };

  const Toggle = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-3 py-1.5 rounded-sm text-sm font-semibold border transition-colors',
        active ? 'bg-zinc-100 text-zinc-900 border-zinc-100' : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800',
      ].join(' ')}
    >
      {children}
    </button>
  );

  const selectCls = 'w-full px-2 py-1.5 rounded-sm bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:border-zinc-500';
  const labelCls = 'text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5';

  return (
    <div className="w-full max-w-3xl mx-auto p-4">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Blunderable</h1>
        <p className="text-zinc-500 text-sm mt-1">Who blunders first? Survive the engine without throwing the position.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
        {/* Left: board + position input */}
        <div className="space-y-3">
          <BoardEditor fen={fen} onFenChange={onBoardFen} orientation={orientation} onFlip={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} ply={plyNav} maxBoard={460} />
          <div>
            <div className={labelCls}>Position — paste a FEN or a PGN</div>
            <textarea
              value={raw}
              onChange={(e) => { setRaw(e.target.value); }}
              onBlur={() => parseInput(raw)}
              rows={3}
              spellCheck={false}
              placeholder={'Paste a FEN  …or…  1. e4 e5 2. Nf3 Nc6 …'}
              className="w-full text-xs font-mono px-2 py-1.5 rounded-sm bg-zinc-900 border border-zinc-700 text-zinc-200 resize-none focus:outline-none focus:border-zinc-500"
            />
            <div className="flex items-center justify-between mt-1">
              <button onClick={() => { setRaw(DEFAULT_FEN); onBoardFen(DEFAULT_FEN); }} className="text-[10px] text-zinc-500 hover:text-zinc-300">Reset to default</button>
              {inputErr && <span className="text-[10px] text-red-400">{inputErr}</span>}
              {!inputErr && fenHist.length > 1 && <span className="text-[10px] text-emerald-500/80">PGN loaded · scrub plies under the board</span>}
            </div>
          </div>
        </div>

        {/* Right: challenge settings */}
        <div className="space-y-5">
          <div>
            <div className={labelCls}>Play as</div>
            <div className="flex gap-2">
              {(['w', 'b'] as const).map((s) => (
                <Toggle key={s} active={side === s} onClick={() => pickSide(s)}>{s === 'w' ? 'White' : 'Black'}</Toggle>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Survive</span>
              <span className="text-sm font-bold tabular-nums text-zinc-200">{target} <span className="text-[10px] font-normal text-zinc-500">moves</span></span>
            </div>
            <input type="range" min={TARGET_MIN} max={TARGET_MAX} step={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Opponent rating</span>
              <span className="text-sm font-bold tabular-nums text-zinc-200">{ratingElo} <span className="text-[10px] font-normal text-zinc-500">{ratingLabel(ratingElo)}</span></span>
            </div>
            <input type="range" min={RATING_MIN} max={RATING_MAX} step={50} value={ratingElo} onChange={(e) => setRatingElo(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <div className={labelCls}>Time</div>
              <select value={clockMin} onChange={(e) => setClockMin(Number(e.target.value))} className={selectCls}>
                {CLOCK_PRESETS_MIN.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className={labelCls}>Increment</div>
              <select value={incS} onChange={(e) => setIncS(Number(e.target.value))} className={selectCls}>
                {INC_PRESETS_S.map((s) => <option key={s} value={s}>{s === 0 ? 'None' : `+${s}s`}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={start} className="flex-1 py-2.5 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors">Start challenge</button>
            <button onClick={() => setShowSave(true)} title="Save this position to practice later" className="px-3 py-2.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-semibold">★ Save</button>
          </div>

          <SavedPositionsList onLoad={loadPosition} />
          <RecentChallenges />
        </div>
      </div>
      {showSave && <SavePositionDialog input={saveInput} onClose={() => setShowSave(false)} />}
    </div>
  );
}

function RecentChallenges() {
  const recent = useRecentChallenges(8);
  if (recent.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Recent</div>
      <div className="space-y-0.5">
        {recent.map((c) => {
          const survived = c.moves.filter((m) => m.cls !== 'blunder').length;
          return (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.result === 'succeeded' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-zinc-300">{c.side === 'w' ? 'White' : 'Black'}</span>
              {c.ratingElo != null && <span className="text-zinc-600 tabular-nums">{c.ratingElo}</span>}
              <span className="text-zinc-500 tabular-nums">{survived}/{c.target}</span>
              <span className={`ml-auto font-semibold ${c.result === 'succeeded' ? 'text-emerald-400' : 'text-red-400'}`}>
                {c.result === 'succeeded' ? 'Survived' : 'Blundered'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Playing screen ───────────────────────────────────────────────────────────

function PlayingScreen({ config, onQuit }: { config: Config; onQuit: () => void }) {
  const { side, fen, target, ratingElo, clockInitialMs, clockIncMs, savedPositionId } = config;
  const chessRef = useRef(new Chess(fen));
  const [position, setPosition] = useState(fen);
  const [status, setStatus] = useState<Status>('init');
  const [playerMoves, setPlayerMoves] = useState(0);
  const [moves, setMoves] = useState<BlunderMove[]>([]);
  const [plies, setPlies] = useState<Ply[]>([]); // every half-move, for the moves list
  const [cumulativeWp, setCumulativeWp] = useState(0); // total self-inflicted win% loss (report stat)
  const [e0Cp, setE0Cp] = useState(0);                 // start eval (player POV cp)
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const [endReason, setEndReason] = useState<EndReason | null>(null);

  // Console-only logging (the on-screen activity log was removed — evals surface
  // in the end report, not during play).
  const log = useCallback((msg: string) => { console.log('[blunderable]', msg); }, []);

  const mounted = useRef(true);
  const endedRef = useRef(false);
  const beforeCp = useRef(0);          // player-POV cp before the current player move
  const bestBefore = useRef<string | null>(null); // engine's best UCI move at that position
  // Speculative reply ("ponder"): while you're on the clock the engine searches
  // the line it expects you to play. If you play it, the reply is already in hand.
  const ponder = useRef<{ fen: string; result: string | null; done: boolean } | null>(null);
  const moveStart = useRef(0);
  const cumWp = useRef(0);             // authoritative cumulative self-loss (win%)
  const e0 = useRef(0);
  const playerMovesRef = useRef(0);    // authoritative survived-move count

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ponder.current && !ponder.current.done) engineService.cancel();
      ponder.current = null;
    };
  }, []);

  // ── Clock ──
  const clock = useRef({ playerMs: clockInitialMs, engineMs: clockInitialMs, active: null as 'player' | 'engine' | null, since: 0 });
  const [clockView, setClockView] = useState({ player: clockInitialMs, engine: clockInitialMs, active: null as 'player' | 'engine' | null });

  const commitClock = useCallback(() => {
    const c = clock.current;
    if (c.active && c.since) {
      const el = Date.now() - c.since;
      if (c.active === 'player') c.playerMs = Math.max(0, c.playerMs - el);
      else c.engineMs = Math.max(0, c.engineMs - el);
    }
    c.since = 0;
  }, []);
  const startClock = useCallback((who: 'player' | 'engine') => {
    commitClock();
    clock.current.active = who;
    clock.current.since = Date.now();
  }, [commitClock]);
  const stopClock = useCallback(() => { commitClock(); clock.current.active = null; }, [commitClock]);
  const addIncrement = useCallback((who: 'player' | 'engine') => {
    if (who === 'player') clock.current.playerMs += clockIncMs; else clock.current.engineMs += clockIncMs;
  }, [clockIncMs]);

  const resolveEnd = useCallback((finalStatus: 'succeeded' | 'failed', reason: EndReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopClock();
    setEndReason(reason);
    if (mounted.current) setStatus(finalStatus);
  }, [stopClock]);

  // Clock tick + flag detection.
  useEffect(() => {
    const id = setInterval(() => {
      const c = clock.current;
      let p = c.playerMs, e = c.engineMs;
      if (c.active === 'player' && c.since) p = Math.max(0, c.playerMs - (Date.now() - c.since));
      if (c.active === 'engine' && c.since) e = Math.max(0, c.engineMs - (Date.now() - c.since));
      setClockView({ player: p, engine: e, active: c.active });
      if (!endedRef.current) {
        if (c.active === 'player' && p <= 0) resolveEnd('failed', 'flagged');
        else if (c.active === 'engine' && e <= 0) resolveEnd('succeeded', 'flagged'); // engine flagged → you survive
      }
    }, 100);
    return () => clearInterval(id);
  }, [resolveEnd]);

  // Full-strength scoring eval, wrapped in a hard timeout. Returns the player-POV
  // cp AND the engine's best move (PV head) at that position — the latter feeds
  // the "you should have played…" hint in the report, for free.
  const playerEval = useCallback(async (f: string): Promise<{ cp: number; bestUci: string | null }> => {
    engineService.setStrength(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { engineService.cancel(); reject(new Error('eval timed out')); }, EVAL_TIMEOUT_MS);
    });
    try {
      const lines = await Promise.race([engineService.evaluateMulti(f, ENGINE_DEPTH, 1), timeout]);
      const top = lines[0];
      if (!top) throw new Error('no eval line returned');
      return { cp: evalForSide(toWhiteCp(top.score, f), side), bestUci: top.pv[0] ?? null };
    } finally {
      clearTimeout(timer);
    }
  }, [side]);

  // Rebuild the half-move list from the live game (for the moves list / PGN).
  const syncPlies = useCallback(() => {
    if (!mounted.current) return;
    const hist = chessRef.current.history({ verbose: true });
    setPlies(hist.map((m) => ({ num: parseInt(m.before.split(' ')[5], 10), color: m.color as 'w' | 'b', san: m.san })));
  }, []);

  const getPgn = useCallback(() => { try { return chessRef.current.pgn(); } catch { return ''; } }, []);

  // Apply a UCI move from the engine to the live board; returns its SAN.
  const applyEngineUci = useCallback((uci: string | null): string | null => {
    if (!uci) return null;
    const chess = chessRef.current;
    const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined });
    if (mounted.current) { setPosition(chess.fen()); syncPlies(); }
    return mv?.san ?? null;
  }, [syncPlies]);

  // Engine plays a move at the chosen rating: node-limited multi-PV search, then
  // a rating-scaled softmax sample over the top lines. If a completed ponder
  // matches the current position its result is reused (instant). Returns the SAN.
  const engineMove = useCallback(async (): Promise<string | null> => {
    const chess = chessRef.current;
    if (chess.isGameOver()) return null;
    const pon = ponder.current;
    if (pon && pon.done && pon.fen === chess.fen()) {
      ponder.current = null;
      if (pon.result) { log('Engine: reused pondered reply'); return applyEngineUci(pon.result); }
    }
    const lines = await engineService.searchNodes(chess.fen(), ratingToNodes(ratingElo), PLAY_MULTIPV);
    const uci = sampleMove(lines, ratingToTempCp(ratingElo));
    if (!uci) { log('Engine: no reply'); return null; }
    return applyEngineUci(uci);
  }, [ratingElo, log, applyEngineUci]);

  // Kick off a speculative search of the position after your predicted best move,
  // so the reply is ready if you play it. Safe on our single worker: any in-flight
  // ponder is cancelled the instant you actually move (before scoring runs).
  const startPonder = useCallback(() => {
    ponder.current = null;
    const predUci = bestBefore.current;
    const chess = chessRef.current;
    if (!predUci || chess.isGameOver()) return;
    let predFen: string;
    try {
      const c = new Chess(chess.fen());
      const pm = c.move({ from: predUci.slice(0, 2), to: predUci.slice(2, 4), promotion: (predUci[4] as 'q' | 'r' | 'b' | 'n') || undefined });
      if (!pm) return;
      predFen = c.fen();
    } catch { return; }
    const entry = { fen: predFen, result: null as string | null, done: false };
    ponder.current = entry;
    engineService.searchNodes(predFen, ratingToNodes(ratingElo), PLAY_MULTIPV)
      .then((lines) => { if (ponder.current === entry) { entry.result = sampleMove(lines, ratingToTempCp(ratingElo)); entry.done = true; } })
      .catch(() => { if (ponder.current === entry) entry.done = true; });
  }, [ratingElo]);

  // Abort any running ponder so the worker is free for scoring/play.
  const cancelPonder = useCallback(() => {
    const pon = ponder.current;
    if (pon && !pon.done) { engineService.cancel(); }
    ponder.current = null;
  }, []);

  // Convert a UCI move to SAN in the context of a given FEN (for the best-move hint).
  const uciToSan = useCallback((fenBefore: string, uci: string | null): string | undefined => {
    if (!uci) return undefined;
    try {
      const c = new Chess(fenBefore);
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined });
      return m?.san;
    } catch { return undefined; }
  }, []);

  // ── Warm-up: load the engine and evaluate the start position, then hold in
  // 'ready' until the player chooses to begin. No clock, no flashing. ──
  const warmUp = useCallback(async () => {
    try {
      await engineService.initialize();
      const start = await playerEval(fen);
      if (!mounted.current) return;
      e0.current = start.cp; beforeCp.current = start.cp; bestBefore.current = start.bestUci;
      setE0Cp(start.cp);
      if (mounted.current) setStatus('ready');
    } catch (e) {
      log(`Engine error: ${e instanceof Error ? e.message : 'failed'}`);
      if (mounted.current) setStatus('error');
    }
  }, [fen, playerEval, log]);

  // ── Begin play (on the player's go): if the engine moves first, it moves now;
  // then the clock starts and it's the player's turn. ──
  const beginPlay = useCallback(async () => {
    if (status !== 'ready') return;
    try {
      if (chessRef.current.turn() !== side) {
        setStatus('thinking');
        await engineMove();
        const next = await playerEval(chessRef.current.fen());
        if (!mounted.current) return;
        beforeCp.current = next.cp; bestBefore.current = next.bestUci;
      }
      if (!mounted.current) return;
      moveStart.current = Date.now();
      startClock('player');
      setStatus('player');
      startPonder();
    } catch (e) {
      log(`Engine error: ${e instanceof Error ? e.message : 'failed'}`);
      if (mounted.current) setStatus('error');
    }
  }, [status, side, engineMove, playerEval, startClock, startPonder, log]);

  useEffect(() => {
    warmUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Board orientation (flip) — defaults to the player's side at the bottom. ──
  const [orientation, setOrientation] = useState<'white' | 'black'>(side === 'w' ? 'white' : 'black');

  // ── Desktop/mobile detection (panel becomes board-height column on desktop) ──
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Board sizing — mirrors /board: cap at 560, measured from the wrapper. ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  useMeasureEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (w: number) => { if (w > 0) setBoardWidth(Math.min(Math.floor(w), 560)); };
    const measure = () => apply(el.getBoundingClientRect().width || Math.min(window.innerWidth * 0.9, window.innerHeight * 0.9, 560));
    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
      ro.observe(el);
      return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    }
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ── Click-to-move selection ──
  const [selectedSq, setSelectedSq] = useState<CbSquare | null>(null);
  const legalTargets = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!selectedSq) return m;
    try {
      const c = new Chess(position);
      for (const mv of c.moves({ square: selectedSq, verbose: true })) m.set(mv.to, !!mv.captured);
    } catch { /* not a movable square */ }
    return m;
  }, [selectedSq, position]);

  // ── Apply a player move (shared by drag + click) ──
  const applyPlayerMove = useCallback((from: CbSquare, to: CbSquare): boolean => {
    if (status !== 'player' || endedRef.current) return false;
    const chess = chessRef.current;
    if (chess.turn() !== side) return false;
    let mv;
    try { mv = chess.move({ from, to, promotion: 'q' }); } catch { return false; }
    if (!mv) return false;

    setSelectedSq(null);
    // Free the worker for scoring if a speculative search is still running (a
    // finished ponder for this exact position is reused later in engineMove()).
    if (ponder.current && !ponder.current.done) cancelPonder();
    const clockMs = Date.now() - moveStart.current;
    const before = beforeCp.current;
    const num = parseInt(mv.before.split(' ')[5], 10);
    const notation = moveNotation(num, mv.color, mv.san);
    // What the engine would have played here — shown only when you missed it.
    const best = uciToSan(mv.before, bestBefore.current);
    const bestSan = best && best !== mv.san ? best : undefined;
    setPosition(chess.fen());
    syncPlies();

    // Player's clock stops, gets the increment, engine's clock starts.
    commitClock(); addIncrement('player'); startClock('engine');
    setStatus('thinking');

    (async () => {
      try {
        // Self-loss: damage from YOUR move, measured before the engine replies.
        const afterMyCp = chess.isGameOver() ? before : (await playerEval(chess.fen())).cp;
        if (!mounted.current) return;
        const wpLoss = Math.max(0, winPForPlayer(before) - winPForPlayer(afterMyCp));
        const cls = classifySelfLoss(wpLoss);
        cumWp.current += wpLoss; setCumulativeWp(cumWp.current);
        recordMove(notation, mv.san, cls, wpLoss, clockMs, afterMyCp, bestSan);
        log(`${notation}: ${CLASS_META[cls].label}, self-loss ${wpLoss.toFixed(1)}% (cum ${cumWp.current.toFixed(1)}%).`);

        if (chess.isCheckmate()) { resolveEnd('succeeded', 'mate'); return; } // you mated the engine
        if (cls === 'blunder') { resolveEnd('failed', 'blunder'); return; }
        if (cumWp.current >= CUMULATIVE_FAIL_WP) { resolveEnd('failed', 'drift'); return; }
        if (chess.isGameOver()) { resolveEnd('succeeded', 'target'); return; } // stalemate/draw — you held

        // Engine replies.
        const engSan = await engineMove();
        if (!mounted.current) return;
        if (chess.isCheckmate()) { updateLastMove({ engineSan: engSan ?? undefined }); resolveEnd('failed', 'mate'); return; } // engine mated you
        const next = chess.isGameOver() ? { cp: afterMyCp, bestUci: null } : await playerEval(chess.fen());
        if (!mounted.current) return;
        beforeCp.current = next.cp; bestBefore.current = next.bestUci;
        updateLastMove({ engineSan: engSan ?? undefined, engineEvalCp: next.cp });

        // Engine's clock stops, gets the increment, your clock resumes.
        commitClock(); addIncrement('engine'); startClock('player');

        if (chess.isGameOver()) { resolveEnd('succeeded', 'target'); return; }
        if (playerMovesRef.current >= target) { resolveEnd('succeeded', 'target'); return; }
        moveStart.current = Date.now();
        if (mounted.current) setStatus('player');
        startPonder(); // pre-search the line we expect you to play
      } catch {
        // Engine hiccup — hand the turn back rather than dead-ending.
        if (!endedRef.current) { commitClock(); startClock('player'); if (mounted.current) setStatus('player'); }
      }
    })();
    return true;

    function recordMove(notation: string, san: string, cls: MoveClass, wpLoss: number, ms: number, evalCp: number, bestSan?: string) {
      if (!mounted.current) return;
      playerMovesRef.current += 1;
      setMoves((prev) => [...prev, { notation, san, cls, wpLoss, clockMs: ms, evalCp, bestSan }]);
      setPlayerMoves(playerMovesRef.current);
    }

    // Merge engine-reply data into the move just recorded (it arrives a beat later).
    function updateLastMove(patch: Partial<BlunderMove>) {
      if (!mounted.current) return;
      setMoves((prev) => prev.length === 0 ? prev : [...prev.slice(0, -1), { ...prev[prev.length - 1], ...patch }]);
    }
  }, [status, side, playerEval, engineMove, uciToSan, syncPlies, target, resolveEnd, commitClock, addIncrement, startClock, startPonder, cancelPonder, log]);

  const onSquareClick = useCallback((square: CbSquare) => {
    if (status !== 'player' || endedRef.current) return;
    const chess = chessRef.current;
    if (selectedSq) {
      if (square === selectedSq) { setSelectedSq(null); return; }
      if (legalTargets.has(square)) { applyPlayerMove(selectedSq, square); return; }
      const piece = chess.get(square);
      if (piece && piece.color === side) { setSelectedSq(square); return; }
      setSelectedSq(null);
      return;
    }
    const piece = chess.get(square);
    if (piece && piece.color === side && chess.moves({ square, verbose: true }).length > 0) setSelectedSq(square);
  }, [status, side, selectedSq, legalTargets, applyPlayerMove]);

  const onPieceDragBegin = useCallback((_p: unknown, square: CbSquare) => {
    if (status === 'player' && !endedRef.current) setSelectedSq(square);
  }, [status]);

  const ended = status === 'failed' || status === 'succeeded';

  // Persist once.
  const saved = useRef(false);
  useEffect(() => {
    if (ended && !saved.current) {
      saved.current = true;
      saveChallenge({
        side, startFen: fen, target, result: status as 'succeeded' | 'failed',
        e0Cp: e0.current, moves, ratingElo, clockInitialMs, clockIncMs,
        endReason: endReason ?? undefined, cumulativeWp: cumWp.current,
      }).catch(() => {});
      if (savedPositionId) recordPractice(savedPositionId, status as 'succeeded' | 'failed').catch(() => {});
    }
  }, [ended, status, side, fen, target, moves, ratingElo, clockInitialMs, clockIncMs, endReason]);

  // On fail, freeze the board and surface threats as arrows.
  const threatArrows = useMemo(
    () => (status === 'failed' ? detectThreats(position).map((t) => [t.from, t.to, t.color] as [CbSquare, CbSquare, string]) : []),
    [status, position],
  );

  // Legal-move highlights (click + drag).
  const squareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (selectedSq) {
      styles[selectedSq] = { background: 'rgba(99,102,241,0.45)' };
      legalTargets.forEach((isCapture, sq) => {
        styles[sq] = isCapture
          ? { background: 'radial-gradient(circle, transparent 64%, rgba(16,185,129,0.55) 65%)' }
          : { background: 'radial-gradient(circle, rgba(16,185,129,0.55) 24%, transparent 25%)' };
      });
    }
    return styles;
  }, [selectedSq, legalTargets]);

  const sideToMove: Side = position.split(' ')[1] === 'b' ? 'b' : 'w';
  const engineFirst = sideToMove !== side;

  const dimClock = status === 'init' || status === 'ready';

  return (
    <div className="w-full max-w-5xl mx-auto p-3 sm:p-4">
      {/* /board-style layout: board left, panel (clock + moves list + controls) right */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
        {/* Board */}
        <div className="shrink-0" style={{ width: 'min(100vw, 90vh, 560px)', maxWidth: '100%' }}>
          <div ref={containerRef} className="w-full" style={{ aspectRatio: '1 / 1' }}>
            {boardWidth > 0 && (
              <Chessboard
                position={position}
                boardWidth={boardWidth}
                boardOrientation={orientation}
                onPieceDrop={applyPlayerMove}
                onSquareClick={onSquareClick}
                onPieceDragBegin={onPieceDragBegin}
                areArrowsAllowed={false}
                customArrows={threatArrows}
                customSquareStyles={squareStyles}
              />
            )}
          </div>
        </div>

        {/* Right panel */}
        <div
          className="w-full lg:flex-1 lg:min-w-[240px] bg-zinc-900 rounded-md flex flex-col lg:overflow-hidden"
          style={isDesktop && boardWidth > 0 ? { height: boardWidth } : undefined}
        >
          {/* Clock + status (top) */}
          <div className="shrink-0 px-3 pt-2 lg:order-1">
            <div className="flex items-center justify-center gap-3">
              <PlayerClock ms={clockView.player} dimmed={dimClock} />
              {status === 'thinking' && <span className="text-xs text-zinc-500">engine…</span>}
            </div>

            {status === 'error' && (
              <div className="rounded-sm px-3 py-2 bg-amber-900/30 border border-amber-800 text-xs mt-1">
                <div className="text-amber-300 font-semibold">Engine didn’t respond</div>
                <button onClick={() => { endedRef.current = false; setStatus('init'); warmUp(); }} className="mt-2 px-3 py-1 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">Retry</button>
              </div>
            )}
            {status === 'init' && (
              <div className="flex items-center justify-center gap-2 text-sm text-zinc-400 py-1">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                Warming up engine &amp; evaluating…
              </div>
            )}
            {status === 'ready' && (
              <div className="flex flex-col items-center gap-1.5 py-1">
                <button onClick={beginPlay} className="w-full py-2.5 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors">Start</button>
                <span className="text-[11px] text-zinc-500 text-center">{engineFirst ? 'Engine moves first — your clock starts after.' : 'Your move first — the clock starts when you begin.'}</span>
              </div>
            )}
            {status === 'failed' && threatArrows.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-zinc-400 pb-1">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: THREAT_COLORS.hanging }} /> hanging</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: THREAT_COLORS.capture }} /> capture</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: THREAT_COLORS.check }} /> check</span>
              </div>
            )}
            {ended && summaryDismissed && (
              <button onClick={() => setSummaryDismissed(false)} className="block w-full text-center text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 py-1">View full report</button>
            )}
          </div>

          {/* Moves list — fills the panel, own scroll (order-2) */}
          <GameMovesList plies={plies} side={side} mode="live" heightClass="max-h-[40vh] lg:max-h-none" className="px-3 py-1 lg:flex-1 lg:min-h-0 lg:order-2" autoScroll />

          {/* Controls (bottom) — flip + quit/new (order-3) */}
          <div className="shrink-0 flex gap-0.5 p-1.5 lg:order-3">
            <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="flex-1 py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm transition-colors" title="Flip board">⇅ Flip</button>
            <button onClick={onQuit} className="flex-1 py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm transition-colors">{ended ? 'New challenge' : 'Quit'}</button>
          </div>
        </div>
      </div>

      {ended && !summaryDismissed && (
        <SummaryModal
          status={status} moves={moves} plies={plies} side={side} endReason={endReason}
          e0Cp={e0Cp} cumulativeWp={cumulativeWp} ratingElo={ratingElo} target={target} survived={playerMoves}
          clockInitialMs={clockInitialMs} clockIncMs={clockIncMs} startFen={fen} getPgn={getPgn}
          onClose={() => setSummaryDismissed(true)} onNewChallenge={onQuit}
        />
      )}
    </div>
  );
}

// ── Player clock — just the time, large and centred (red when low, dim before play). ──
function PlayerClock({ ms, dimmed = false }: { ms: number; dimmed?: boolean }) {
  const low = ms <= 30_000;
  return (
    <div className="flex justify-center py-1">
      <span className={`font-mono text-4xl font-bold tabular-nums ${dimmed ? 'text-zinc-600' : low ? 'text-red-500' : 'text-zinc-100'}`}>{fmtClock(ms)}</span>
    </div>
  );
}

// Move-time chart with x/y axes: one bar per move (height ∝ seconds, tinted by
// time band), a dot above sub-par moves, y-axis seconds and x-axis move numbers.
function MoveTimesChart({ moves, clockInitialMs }: { moves: BlunderMove[]; clockInitialMs: number }) {
  if (moves.length === 0) return null;
  const maxMs = Math.max(...moves.map((m) => m.clockMs), 1);
  const maxS = maxMs / 1000;
  const H = 80;
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-zinc-500 mb-1">Time per move</div>
      <div className="flex">
        {/* Y axis (seconds) */}
        <div className="flex flex-col justify-between text-[8px] tabular-nums text-zinc-600 pr-1.5 text-right" style={{ height: H }}>
          <span>{maxS.toFixed(maxS >= 10 ? 0 : 1)}s</span>
          <span>{(maxS / 2).toFixed(maxS >= 10 ? 0 : 1)}s</span>
          <span>0</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative flex items-end gap-1 border-l border-b border-zinc-700/70" style={{ height: H }}>
            <span className="absolute left-0 right-0 border-t border-dashed border-zinc-800" style={{ bottom: H / 2 }} />
            {moves.map((m, i) => {
              const tcls = classifyMoveTime(m.clockMs, clockInitialMs);
              const h = Math.max(2, Math.round((m.clockMs / maxMs) * (H - 4)));
              return (
                <div key={i} className="flex-1 flex flex-col justify-end items-center min-w-0" title={`${m.notation} · ${(m.clockMs / 1000).toFixed(1)}s`}>
                  {m.cls !== 'ok' && <span className="w-1 h-1 rounded-full mb-0.5" style={{ background: CLASS_META[m.cls].color }} />}
                  <div className="w-full rounded-t-sm" style={{ height: h, background: TIME_META[tcls].color, opacity: tcls === 'quick' ? 0.45 : 1 }} />
                </div>
              );
            })}
          </div>
          {/* X axis (move numbers) */}
          <div className="flex gap-1 mt-0.5 pl-px">
            {moves.map((m, i) => {
              const num = (m.notation.split(/[.…]/)[0] ?? '').trim();
              const show = moves.length <= 8 || i % 2 === 0;
              return <div key={i} className="flex-1 text-center text-[8px] tabular-nums text-zinc-600 min-w-0 truncate">{show ? num : ''}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const REASON_TEXT: Record<EndReason, string> = {
  blunder: 'A blunder ended the run — check the board for the threats.',
  drift: 'Too much ground given up over the run — death by a thousand cuts.',
  flagged: 'The clock ran out.',
  target: 'You held the position to the target.',
  mate: 'Checkmate.',
};

// Footing-aware verdict. Branches on where you STARTED (winning / level / worse)
// before describing the swing — so a game you were losing from move one never
// reads "you let the advantage go". swing = endWp − startWp (+ = you improved).
function footingVerdict(e0Cp: number, endCp: number): { text: string; color: string } {
  const swing = winPForPlayer(endCp) - winPForPlayer(e0Cp);
  const col = swing >= 3 ? '#34d399' : swing >= -3 ? '#a3e635' : swing >= -12 ? '#facc15' : '#fb923c';
  let text: string;
  if (e0Cp >= 50) {
    text = swing >= -3 ? 'You were better and held it — a clean job.'
      : swing >= -12 ? 'You had the edge but let part of it slip — likely missed the key idea.'
      : 'You were winning and let a lot slip — study where it went.';
  } else if (e0Cp > -50) {
    text = swing >= 5 ? 'From a level start, you outplayed the engine.'
      : swing >= -5 ? 'Roughly level throughout — you held the balance.'
      : 'From an equal start, you drifted into trouble.';
  } else {
    text = swing >= 5 ? 'You started worse but clawed back ground — well defended.'
      : swing >= -6 ? 'You were worse from the outset and held it together — surviving was the job.'
      : 'You were already worse and it slipped further — a tough spot from the start.';
  }
  return { text, color: col };
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-base font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function CloseX({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Close" className="grid place-items-center w-7 h-7 rounded-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    </button>
  );
}

function SummaryModal({ status, moves, plies, side, endReason, e0Cp, cumulativeWp, ratingElo, target, survived, clockInitialMs, clockIncMs, startFen, getPgn, onClose, onNewChallenge }: {
  status: Status; moves: BlunderMove[]; plies: Ply[]; side: Side; endReason: EndReason | null;
  e0Cp: number; cumulativeWp: number; ratingElo: number; target: number; survived: number; clockInitialMs: number;
  clockIncMs: number; startFen: string; getPgn: () => string; onClose: () => void; onNewChallenge: () => void;
}) {
  const succeeded = status === 'succeeded';
  const [showSave, setShowSave] = useState(false);
  const counts = { blunder: 0, mistake: 0, inaccuracy: 0, ok: 0 } as Record<MoveClass, number>;
  for (const m of moves) counts[m.cls]++;
  const accs = moves.map((m) => moveAccuracy(m.wpLoss ?? 0, 0));
  const accuracy = accs.length ? Math.round(accs.reduce((s, v) => s + v, 0) / accs.length) : 100;
  const endEvalCp = moves.length ? (moves[moves.length - 1].engineEvalCp ?? moves[moves.length - 1].evalCp ?? e0Cp) : e0Cp;
  const totalTimeS = moves.reduce((s, m) => s + m.clockMs, 0) / 1000;
  const fmtEval = (cp: number) => `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
  const accColor = accuracy >= 90 ? '#34d399' : accuracy >= 75 ? '#facc15' : '#f87171';
  // Net win% swing start→end (signed: + you improved, − you made it worse).
  const swingWp = winPForPlayer(endEvalCp) - winPForPlayer(e0Cp);
  const swingTxt = Math.abs(swingWp) < 0.5 ? '±0%' : `${swingWp > 0 ? '+' : '−'}${Math.abs(swingWp).toFixed(0)}%`;
  const verdict = footingVerdict(e0Cp, endEvalCp);
  // Rough performance estimate from average self-inflicted win% loss (a guide, not exact).
  const avgLoss = moves.length ? cumulativeWp / moves.length : 0;
  const estRating = Math.round(Math.max(700, Math.min(2900, 2800 - avgLoss * 70)) / 10) * 10;
  // Your weakest move — what to look at first.
  const weakest = moves.reduce<BlunderMove | null>((w, m) => ((m.wpLoss ?? 0) > (w?.wpLoss ?? 0) ? m : w), null);
  const showWeakest = weakest != null && (weakest.wpLoss ?? 0) >= 3;
  const badClasses = (['blunder', 'mistake', 'inaccuracy'] as MoveClass[]).filter((c) => counts[c] > 0);

  const downloadPgn = () => {
    const pgn = getPgn();
    if (!pgn) return;
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'blunderable.pgn'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-md shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header — neutral, with X close */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-800">
          <div>
            <div className="text-lg font-bold text-zinc-100">{succeeded ? 'Survived' : 'Blundered'}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{endReason ? REASON_TEXT[endReason] : (succeeded ? 'You held the position.' : 'The run ended.')}</div>
          </div>
          <CloseX onClick={onClose} />
        </div>

        <div className="px-5 py-4 overflow-y-auto min-h-0 space-y-4">
          {/* Headline: start → end + verdict (neutral chrome, colour only on the numbers/text) */}
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">Position</span>
              <span className="font-mono text-lg tabular-nums text-zinc-100">
                {fmtEval(e0Cp)} <span className="text-zinc-600">→</span> {fmtEval(endEvalCp)}
                <span className="ml-2 font-bold" style={{ color: verdict.color }}>{swingTxt}</span>
              </span>
            </div>
            <p className="text-sm mt-1 leading-snug" style={{ color: verdict.color }}>{verdict.text}</p>
          </div>

          {/* Weakest move — prominent, scannable */}
          {showWeakest && (
            <div className="flex items-center gap-3">
              <span className="text-[9px] uppercase tracking-widest text-zinc-500 w-14 shrink-0 leading-tight">Weakest move</span>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-base text-zinc-100">{weakest!.notation}</span>
                {CLASS_META[weakest!.cls].glyph && <span className="font-mono font-bold text-base" style={{ color: CLASS_META[weakest!.cls].color }}>{CLASS_META[weakest!.cls].glyph}</span>}
                <span className="tabular-nums font-bold" style={{ color: CLASS_META[weakest!.cls].color }}>−{(weakest!.wpLoss ?? 0).toFixed(0)}%</span>
                {weakest!.bestSan && <span className="text-xs text-zinc-500">better: <span className="font-mono text-emerald-400/90">{weakest!.bestSan}</span></span>}
              </div>
            </div>
          )}

          {/* Primary stats */}
          <div className="grid grid-cols-4 gap-x-2 gap-y-3">
            <Stat label="Accuracy" value={`${accuracy}%`} color={accColor} />
            <Stat label="Survived" value={`${survived}/${target}`} />
            <Stat label="Opponent" value={`${ratingElo}`} />
            <Stat label="Your (est.)" value={`${estRating}`} />
          </div>

          {/* Secondary, muted */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            {badClasses.map((c) => (
              <span key={c} className="flex items-center gap-1">
                <span className="tabular-nums font-semibold" style={{ color: CLASS_META[c].color }}>{counts[c]}</span>
                <span>{CLASS_META[c].label.toLowerCase()}{counts[c] === 1 ? '' : 's'}</span>
              </span>
            ))}
            <span className="tabular-nums">{cumulativeWp.toFixed(0)}% win lost</span>
            <span className="tabular-nums">{totalTimeS.toFixed(0)}s{moves.length ? ` · ${(totalTimeS / moves.length).toFixed(1)}s/mv` : ''}</span>
          </div>

          <MoveTimesChart moves={moves} clockInitialMs={clockInitialMs} />

          {/* Moves list — PGN scoresheet with quality, eval & time bars */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] uppercase tracking-wide text-zinc-500">Moves</span>
              <button onClick={downloadPgn} className="text-[11px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2">Download PGN</button>
            </div>
            <GameMovesList plies={plies} side={side} moves={moves} mode="report" clockInitialMs={clockInitialMs} autoScroll={false} heightClass="max-h-56" className="rounded-sm border border-zinc-800 px-3 py-1.5" />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex gap-2">
          <button onClick={() => setShowSave(true)} className="px-3 py-2 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-semibold" title="Save this position to practice later">★ Save position</button>
          <button onClick={onNewChallenge} className="flex-1 py-2 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">New challenge</button>
        </div>
      </div>

      {showSave && (
        <SavePositionDialog
          input={{ fen: startFen, side, ratingElo, target, clockInitialMs, clockIncMs, source: 'blunderable' }}
          onClose={() => setShowSave(false)}
        />
      )}
    </div>
  );
}

// ─── Shell ──────────────────────────────────────────────────────────────────

export function BlunderableShell({ initialPositionId }: { initialPositionId?: string }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [config, setConfig] = useState<Config | null>(null);

  const start = useCallback((cfg: Config) => { setConfig(cfg); setPhase('playing'); }, []);
  const quit = useCallback(() => { setPhase('setup'); setConfig(null); }, []);

  const playKey = useMemo(() => (config ? `${config.side}-${config.target}-${config.ratingElo}-${config.fen}` : 'none'), [config]);

  return phase === 'setup' || !config ? (
    <SetupScreen onStart={start} initialPositionId={initialPositionId} />
  ) : (
    <PlayingScreen key={playKey} config={config} onQuit={quit} />
  );
}
