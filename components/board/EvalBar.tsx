'use client';

interface EvalBarProps {
  score: number | null;
  mate?: number | null;
  height: number;
}

function formatLabel(score: number | null, mate?: number | null): string {
  if (score === null) return '';
  if (mate != null) return `M${Math.abs(mate)}`;
  const abs = Math.abs(score / 100).toFixed(1);
  return score >= 0 ? `+${abs}` : `-${abs}`;
}

export function EvalBar({ score, mate, height }: EvalBarProps) {
  const clamped = score !== null ? Math.max(-1000, Math.min(1000, score)) : 0;
  // 50% = equal; each 100cp shifts by 5%; capped at 0/100
  const whitePct = Math.max(0, Math.min(100, 50 + clamped / 20));
  const label = formatLabel(score, mate);
  const isWhiteAhead = (score ?? 0) >= 0;

  return (
    <div
      className="relative rounded-sm overflow-hidden bg-zinc-900 select-none shrink-0"
      style={{ width: 16, height }}
    >
      {/* Black section (top) */}
      <div
        className="absolute inset-x-0 top-0 bg-zinc-800 transition-all duration-300 ease-out"
        style={{ height: `${100 - whitePct}%` }}
      />
      {/* White section (bottom) */}
      <div
        className="absolute inset-x-0 bottom-0 bg-white transition-all duration-300 ease-out"
        style={{ height: `${whitePct}%` }}
      />
      {/* Score label — overlaid inside the bar on the winning side */}
      {label && (
        <span
          className={[
            'absolute left-1/2 -translate-x-1/2 text-[8px] font-mono leading-none',
            isWhiteAhead
              ? 'bottom-1 text-zinc-700'
              : 'top-1 text-zinc-300',
          ].join(' ')}
        >
          {label}
        </span>
      )}
    </div>
  );
}
