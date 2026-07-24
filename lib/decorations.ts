// Shared decoration model for the board's right-click/long-press annotation
// engine: arrows, square/zone highlights, and one-shot animations. Single
// source of truth for color constants and PGN-exportability rules — replaces
// the ARROW_COLOR/HIGHLIGHT_COLOR consts that used to live in BoardShell.tsx
// and the {from,to,color?}/{square,color?} shapes duplicated across
// useBoardGame.ts, lib/db.ts, lib/pgnImport.ts, and lib/gameTree.ts.

// Canonical color values are the PGN [%cal]/[%csl] letters (R/G/B/Y) so every
// already-saved Library game/draft and already-exported PGN keeps rendering
// identically. GRAY is a fifth, app-only value with no PGN letter.
export type DecorationColor = 'R' | 'G' | 'B' | 'Y' | 'GRAY';

export const COLOR_LABEL: Record<DecorationColor, string> = {
  R: 'Red',
  G: 'Green',
  B: 'Blue',
  Y: 'Amber',
  GRAY: 'Gray',
};

export const ARROW_RENDER_COLOR: Record<DecorationColor, string> = {
  R: 'rgba(239,68,68,0.85)',
  G: 'rgba(34,197,94,0.85)',
  B: 'rgba(59,130,246,0.85)',
  Y: 'rgba(255,180,0,0.85)',
  GRAY: 'rgba(148,163,184,0.85)',
};

export const HIGHLIGHT_RENDER_COLOR: Record<DecorationColor, string> = {
  R: 'rgba(239,68,68,0.45)',
  G: 'rgba(34,197,94,0.4)',
  B: 'rgba(59,130,246,0.4)',
  Y: 'rgba(255,180,0,0.4)',
  GRAY: 'rgba(148,163,184,0.4)',
};

// Legacy colorless arrows/highlights (drawn before colors existed, or hand-
// drawn without a color picker) fall back to this — unchanged from the old
// DEFAULT_ARROW_COLOR/DEFAULT_HIGHLIGHT_COLOR behavior.
export const DEFAULT_COLOR: DecorationColor = 'Y';

export const ARROW_COLOR_OPTIONS: DecorationColor[] = ['R', 'B', 'Y', 'G', 'GRAY'];
export const HIGHLIGHT_COLOR_OPTIONS: DecorationColor[] = ['R', 'B', 'Y', 'G', 'GRAY'];

// PGN [%cal]/[%csl] only understands R/G/B/Y — GRAY has no letter and must
// never be emitted.
export function pgnLetter(color?: DecorationColor): string | undefined {
  if (color === 'GRAY') return undefined;
  return color ?? DEFAULT_COLOR;
}

export interface ArrowDecoration {
  id: string;
  order: number;
  from: string;
  to: string;
  color?: DecorationColor;
}

export interface HighlightDecoration {
  id: string;
  order: number;
  square: string;    // anchor square — kept for back-compat with StoredAnnotation.highlights
  squares?: string[]; // present only for zone highlights (all covered squares, incl. `square`); app-only, never exported
  color?: DecorationColor;
}

export type AnimationEffect = 'bounce' | 'pulsate' | 'shake';

// Animations are always piece-scoped (bounce/pulsate/shake the piece on one
// square) — Animate Square/Zone were removed as unwanted options.
export interface AnimationDecoration {
  id: string;
  order: number;
  square: string;
  effect: AnimationEffect;
  color?: DecorationColor;
}

// A decoration only survives a PGN round-trip if standard PGN software could
// parse it back: a single square/pair of squares in a standard color.
export function isPgnExportableHighlight(h: HighlightDecoration): boolean {
  return (!h.squares || h.squares.length <= 1) && h.color !== 'GRAY';
}

export function isPgnExportableArrow(a: ArrowDecoration): boolean {
  return a.color !== 'GRAY';
}

let _idCounter = 0;

// Stable, unique-enough id for a decoration. Prefer crypto.randomUUID when
// available (browser runtime); fall back to a counter for SSR/test contexts.
export function newDecorationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dec${++_idCounter}`;
}
