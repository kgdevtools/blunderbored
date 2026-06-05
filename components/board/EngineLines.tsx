'use client';
import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { EngineMultiLine } from '@/lib/engine';
import type { Square, PieceSymbol } from 'chess.js';
import { EngineOfflineButton } from './EngineOfflineButton';

// Shared sizing so the engine-row controls (ON / Show Lines / offline) match.
// No rounding — the three controls form a single flush segmented bar (see the
// `divide-x` group below); dividers come from the wrapper, not the buttons.
export const ENGINE_BTN = 'px-2 py-1 text-xs leading-none tracking-tight font-medium transition-colors shrink-0';

interface EngineLinesProps {
  lines: EngineMultiLine[];
  depth: number;
  isComputing: boolean;
  enabled: boolean;
  onToggle: () => void;
  currentFen: string;
}

function pvToSan(fen: string, uciPv: string[], maxMoves = 6): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  for (const uci of uciPv.slice(0, maxMoves)) {
    try {
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      const promo = uci[4] as PieceSymbol | undefined;
      const move = chess.move({ from, to, ...(promo ? { promotion: promo } : {}) });
      if (!move) break;
      parts.push(move.san);
    } catch {
      break;
    }
  }
  return parts.join(' ');
}

function formatScore(line: EngineMultiLine): string {
  if (line.mate != null) return `M${Math.abs(line.mate)}`;
  const abs = Math.abs(line.score / 100).toFixed(2);
  return line.score >= 0 ? `+${abs}` : `−${abs}`;
}

function evalColor(line: EngineMultiLine): string {
  if (line.mate != null) return line.mate > 0 ? 'text-white' : 'text-zinc-400';
  if (line.score > 30) return 'text-white';
  if (line.score < -30) return 'text-zinc-400';
  return 'text-zinc-300';
}

export function EngineLines({ lines, depth, isComputing, enabled, onToggle, currentFen }: EngineLinesProps) {
  const [linesVisible, setLinesVisible] = useState(false);

  const rendered = useMemo(
    () => lines.map((l) => ({ ...l, san: pvToSan(currentFen, l.pv) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, currentFen],
  );

  const best = lines[0];
  const headerScore = best
    ? best.mate != null
      ? `M${Math.abs(best.mate)}`
      : (() => { const a = Math.abs(best.score / 100).toFixed(2); return best.score >= 0 ? `+${a}` : `−${a}`; })()
    : null;
  const headerScoreColor = best
    ? best.score > 30 || (best.mate != null && best.mate > 0)
      ? 'text-white'
      : best.score < -30 || (best.mate != null && best.mate < 0)
        ? 'text-zinc-400'
        : 'text-zinc-300'
    : 'text-zinc-600';

  const showLines = enabled && linesVisible;

  return (
    <div className="mt-2">
      {/* Header — the engine buttons sit flush against the top & bottom rules
          (no vertical padding on the row; px gives a little horizontal breathing room). */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 border-y border-zinc-700">
        {/* Eval score — prominent */}
        <span className={`font-mono font-bold text-sm tracking-tight tabular-nums ${enabled && headerScore ? headerScoreColor : 'text-zinc-600'}`}>
          {enabled && headerScore ? headerScore : '—'}
        </span>
        {/* Engine label */}
        <span className="text-xs font-semibold tracking-tight text-zinc-300 flex-1 min-w-0 truncate">
          Stockfish 18 Lite
        </span>

        {/* Segmented control: ON / Show Lines / offline — flush, no rounding,
            hairline dividers between them. */}
        <div className="flex items-stretch shrink-0 divide-x divide-zinc-900/70">
          {/* On → Off toggle (text = action that will happen on click) */}
          <button
            onClick={onToggle}
            className={[
              ENGINE_BTN,
              enabled
                ? 'bg-green-700 hover:bg-green-600 text-green-50'
                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200',
            ].join(' ')}
          >
            {enabled ? 'OFF' : 'ON'}
          </button>

          {/* Show / Hide Engine Lines — disabled while engine is off */}
          <button
            onClick={() => setLinesVisible((v) => !v)}
            disabled={!enabled}
            className={[
              ENGINE_BTN,
              !enabled
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : linesVisible
                  ? 'bg-blue-700 hover:bg-blue-600 text-blue-50'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200',
            ].join(' ')}
          >
            {linesVisible ? 'Hide Lines' : 'Show Engine Lines'}
          </button>

          {/* Offline-save control — pre-downloads the engine so analysis works offline */}
          <EngineOfflineButton />
        </div>
      </div>

      {/* Lines panel */}
      {showLines && (
        <div className="font-mono px-2 pt-1.5">
          {rendered.length === 0 && isComputing && (
            <p className="text-[11px] tracking-tight text-zinc-500 animate-pulse leading-none py-0.5">
              Analysing…
            </p>
          )}

          {rendered.map((line, idx) => (
            <div
              key={line.rank}
              className={[
                'flex gap-2 items-baseline py-0.5',
                idx !== 0 ? 'border-t border-zinc-800/60' : '',
              ].join(' ')}
            >
              <span className={`text-xs font-bold tracking-tight tabular-nums w-11 shrink-0 leading-none ${evalColor(line)}`}>
                {formatScore(line)}
              </span>
              <span className="text-xs tracking-tight leading-tight text-zinc-300 truncate">
                {line.san}
              </span>
            </div>
          ))}

          {/* Footer */}
          <div className="flex items-center gap-2 text-[10px] tracking-tight text-zinc-600 mt-1 pt-1 border-t border-zinc-800 leading-none">
            <span className="flex items-center gap-1">
              {isComputing && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
              d{depth || '—'}
            </span>
            <span className="pl-2">Stockfish 18 Lite</span>
          </div>
        </div>
      )}
    </div>
  );
}
