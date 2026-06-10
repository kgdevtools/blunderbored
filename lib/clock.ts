// Post-hoc clock parsing from a PGN's [%clk] comments. Read-only — never part
// of the analysis pipeline, so it can't slow the reviewer. Returns null when the
// PGN carries no clock data (e.g. games not from Lichess), so the UI can hide
// the time charts gracefully.

export interface ClockData {
  remaining: number[];          // seconds left after each ply, aligned to moveIndex
  spent: (number | null)[];     // seconds spent on each ply (null where unknown)
  increment: number;            // seconds added per move (from TimeControl)
}

export function parseClocks(pgn: string): ClockData | null {
  const clkRe = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  const remaining: number[] = [];
  for (const m of pgn.matchAll(clkRe)) {
    remaining.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]));
  }
  if (remaining.length === 0) return null;

  // Increment from [TimeControl "base+inc"].
  let increment = 0;
  const tc = pgn.match(/\[TimeControl\s+"(\d+)\+(\d+)"\]/);
  if (tc) increment = Number(tc[2]);

  // Time spent on ply i = (same side's previous clock) − (this clock) + increment.
  // Same side is two plies back. First two plies have no prior, so null.
  const spent: (number | null)[] = remaining.map((r, i) => {
    if (i < 2) return null;
    const prev = remaining[i - 2];
    return Math.max(0, prev - r + increment);
  });

  return { remaining, spent, increment };
}

// PGN [%clk] form: always H:MM:SS (hours not zero-padded), e.g. "0:09:58".
// Fractional seconds are dropped — PGN clk is whole-second in practice.
export function formatClk(s: number): string {
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Compact mm:ss (or h:mm:ss) for display.
export function formatSeconds(s: number): string {
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
}
