// Standard PGN NAG glyph set — single source of truth shared by MovesList's
// tagging picker and BoardShell's on-board glyph badge.

export interface NagOption {
  code: number;
  glyph: string;
  color: string; // Tailwind text-color class
}

// Ordered best → worst for the picker.
export const NAG_OPTIONS: NagOption[] = [
  { code: 3, glyph: '!!', color: 'text-green-400' },
  { code: 1, glyph: '!',  color: 'text-green-400' },
  { code: 5, glyph: '!?', color: 'text-blue-400' },
  { code: 6, glyph: '?!', color: 'text-amber-400' },
  { code: 2, glyph: '?',  color: 'text-red-400' },
  { code: 4, glyph: '??', color: 'text-red-400' },
];

export const NAG_BY_CODE = new Map(NAG_OPTIONS.map((n) => [n.code, n]));
