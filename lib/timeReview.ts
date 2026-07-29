// Custom "time reviewer": classifies how long a player spent on a single move
// (from PGN [%clk] data — see lib/clock.ts's `spent[]`) into a named band.
// Thresholds are seconds-spent-on-one-move, scaled per time control: what's a
// throwaway pause in Classical is a red flag in Bullet.

import type { GameFormat } from './gameMeta';

export type TimeBand = 'key-moment' | 'long-think' | 'critical' | 'time-trouble';

export const TIME_BAND_META: Record<TimeBand, { label: string; color: string }> = {
  'key-moment':   { label: 'Key Moment',   color: 'text-yellow-400' },
  'long-think':   { label: 'Long Think',   color: 'text-orange-400' },
  critical:       { label: 'Critical',     color: 'text-red-400' },
  'time-trouble': { label: 'Time Trouble', color: 'text-red-600' },
};

// [key-moment, long-think, critical, time-trouble] thresholds, in seconds
// spent on one move. Blitz is the seeded reference (a 3+0/180s game: 15s /
// 25s / 40s / 60s — "40s in blitz is Critical, more than that you should go
// study or resign"). Other formats scale from typical base times in that
// bracket (lib/gameMeta.ts's gameFormat() buckets), not a continuous formula,
// so each row stays independently tunable.
const THRESHOLDS: Record<GameFormat, [number, number, number, number]> = {
  Bullet:    [8, 12, 20, 30],
  Blitz:     [15, 25, 40, 60],
  Rapid:     [45, 75, 120, 180],
  Classical: [90, 150, 240, 360],
  Normal:    [90, 150, 240, 360], // no standard TimeControl (e.g. correspondence) — fall back to Classical's scale
};

const BANDS: TimeBand[] = ['key-moment', 'long-think', 'critical', 'time-trouble'];

// Returns the highest band `spentSeconds` crosses for this format, or null
// when below the lowest threshold (nothing notable) or unknown (null input —
// e.g. the first two plies, which have no prior same-side clock reading).
export function classifyTimeSpent(spentSeconds: number | null, format: GameFormat): TimeBand | null {
  if (spentSeconds == null) return null;
  const thresholds = THRESHOLDS[format];
  let band: TimeBand | null = null;
  for (let i = 0; i < BANDS.length; i++) {
    if (spentSeconds >= thresholds[i]) band = BANDS[i];
  }
  return band;
}
