'use client';
import type { GameNode, NodeMeta } from '@/lib/gameTree';
import { formatSeconds } from '@/lib/clock';

// Each player's clock at the current position, read from the PGN's [%clk] data.
// White's clock = the most recent White move's remaining time at/under the
// current node; likewise Black. Walking up the parent chain handles the current
// node being either colour (and positions before either side has a clock).
function clocksAt(node: GameNode, nodeMeta: Map<string, NodeMeta>): { white?: number; black?: number } {
  let white: number | undefined;
  let black: number | undefined;
  let cur: GameNode | null = node;
  while (cur && (white === undefined || black === undefined)) {
    const clk = cur.move ? nodeMeta.get(cur.id)?.clk : undefined;
    if (clk !== undefined) {
      if (cur.move!.color === 'w' && white === undefined) white = clk;
      else if (cur.move!.color === 'b' && black === undefined) black = clk;
    }
    cur = cur.parent;
  }
  return { white, black };
}

function ClockCell({ time, active, align }: { time?: number; active: boolean; align: 'left' | 'right' }) {
  const text = time !== undefined ? formatSeconds(time) : '-:--';
  // All-segments-on backdrop, so unlit segments stay faintly visible (LCD look).
  const ghost = text.replace(/\d/g, '8');
  return (
    <div
      className={[
        'flex-1 px-2.5 py-1.5 rounded-[2px] flex items-center bg-black border transition-colors',
        align === 'right' ? 'justify-end' : 'justify-start',
        active ? 'border-zinc-500' : 'border-zinc-800',
      ].join(' ')}
    >
      <span className="relative inline-block font-dseg text-[14px] leading-none">
        <span aria-hidden className="absolute inset-0 text-white/[0.07] select-none">{ghost}</span>
        <span
          className={active ? 'relative text-white' : 'relative text-zinc-400'}
          style={active ? { textShadow: '0 0 5px rgba(255,255,255,0.45)' } : undefined}
        >
          {text}
        </span>
      </span>
    </div>
  );
}

// Renders nothing when the game carries no clock data, so the strip simply
// disappears for games without [%clk] (e.g. non-Lichess PGNs).
export function ClockDisplay({ current, nodeMeta }: { current: GameNode; nodeMeta: Map<string, NodeMeta> }) {
  const { white, black } = clocksAt(current, nodeMeta);
  if (white === undefined && black === undefined) return null;

  // Side to move at the current position = opposite of the move just played
  // (White to move at the start).
  const toMove: 'w' | 'b' = current.move ? (current.move.color === 'w' ? 'b' : 'w') : 'w';

  return (
    <div className="flex items-stretch gap-1 text-xs font-mono mb-2" aria-label="Clock times">
      <ClockCell time={white} active={toMove === 'w'} align="left" />
      <ClockCell time={black} active={toMove === 'b'} align="right" />
    </div>
  );
}
