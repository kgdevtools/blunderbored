'use client';
import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { EngineMultiLine } from '@/lib/engine';
import type { Square, PieceSymbol } from 'chess.js';

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
    <div className="border-t border-zinc-700 pt-2 mt-2">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1">
        {/* Eval score — prominent */}
        <span className={`font-mono font-bold text-sm tracking-tight tabular-nums ${enabled && headerScore ? headerScoreColor : 'text-zinc-600'}`}>
          {enabled && headerScore ? headerScore : '—'}
        </span>
        {/* Engine label — subordinate */}
        <span className="text-[10px] tracking-tight text-zinc-500 flex-1 leading-none">
          Stockfish 18 Lite
        </span>

        {/* On → Off toggle (text = action that will happen on click) */}
        <button
          onClick={onToggle}
          className={[
            'px-2 py-0.5 rounded text-xs font-mono tracking-tight transition-colors shrink-0',
            enabled
              ? 'bg-green-800 hover:bg-green-700 text-green-100'
              : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
          ].join(' ')}
        >
          {enabled ? 'OFF' : 'ON'}
        </button>

        {/* Show / Hide Engine Lines — disabled while engine is off */}
        <button
          onClick={() => setLinesVisible((v) => !v)}
          disabled={!enabled}
          className={[
            'px-2 py-0.5 rounded text-xs tracking-tight transition-colors shrink-0',
            !enabled
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : linesVisible
                ? 'bg-blue-800 hover:bg-blue-700 text-blue-100'
                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
          ].join(' ')}
        >
          {linesVisible ? 'Hide Lines' : 'Show Engine Lines'}
        </button>
      </div>

      {/* Lines panel */}
      {showLines && (
        <div className="font-mono">
          {rendered.length === 0 && isComputing && (
            <p className="text-[10px] tracking-tight text-zinc-500 animate-pulse leading-none py-0.5">
              Analysing…
            </p>
          )}

          {rendered.map((line, idx) => (
            <div
              key={line.rank}
              className={[
                'flex gap-1.5 items-baseline py-px',
                idx !== 0 ? 'border-t border-zinc-800/60' : '',
              ].join(' ')}
            >
              <span className={`text-xs font-bold tracking-tighter tabular-nums w-10 shrink-0 leading-none ${evalColor(line)}`}>
                {formatScore(line)}
              </span>
              <span className="text-[11px] tracking-tight leading-none text-zinc-300 truncate">
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
            <span>Stockfish 18 Lite</span>
          </div>
        </div>
      )}
    </div>
  );
}
