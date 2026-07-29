'use client';
import type { GameNode, NodeMeta } from '@/lib/gameTree';
import { formatSeconds } from '@/lib/clock';

// Each player's clock at the current position, read from the PGN's [%clk] data.
// White's clock = the most recent White move's remaining time at/under the
// current node; likewise Black. Walking up the parent chain handles the current
// node being either colour (and positions before either side has a clock).
export function clocksAt(node: GameNode, nodeMeta: Map<string, NodeMeta>): { white?: number; black?: number } {
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

// A single player's clock, always right-aligned — rides inside that player's
// name row (see BoardShell's PlayerRow) rather than a shared two-up strip.
// Renders nothing when this side has no clock reading (e.g. non-Lichess PGN).
export function ClockChip({ time, active }: { time?: number; active: boolean }) {
  if (time === undefined) return null;
  const text = formatSeconds(time);
  // All-segments-on backdrop, so unlit segments stay faintly visible (LCD look).
  const ghost = text.replace(/\d/g, '8');
  return (
    <div
      className={[
        'shrink-0 px-2.5 py-1 rounded-[2px] flex items-center justify-end bg-black border transition-colors',
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
