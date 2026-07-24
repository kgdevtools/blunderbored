'use client';
import { useMemo, type FC } from 'react';
import { Chess } from 'chess.js';
import type { CustomSquareProps } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import type { ReviewedMove } from '@/lib/analysis';
import { QUALITY_META, type MoveQuality } from '@/lib/accuracy';

// Renders the move-quality glyph (per lib/accuracy.ts's QUALITY_META) as a
// small badge in the corner of the square a move landed on — shared between
// ReviewerShell and PuzzleGeneratorShell, both of which page through a
// GameReview move-by-move on the same Chessboard component.
export function useQualityGlyphSquare(move: ReviewedMove | null): FC<CustomSquareProps> | undefined {
  const glyphSquare = useMemo(() => {
    if (!move || move.quality === 'book') return null;
    try {
      const chess = new Chess(move.fenBefore);
      const played = chess.move(move.moveSan);
      return played ? { square: played.to, quality: move.quality } : null;
    } catch { return null; }
  }, [move?.fenBefore, move?.moveSan, move?.quality]);

  const customSquare: FC<CustomSquareProps> | undefined = useMemo(() => {
    if (!glyphSquare) return undefined;
    const { square: glyphSq, quality } = glyphSquare;
    const meta = QUALITY_META[quality as MoveQuality];
    return function GlyphSquare({ children, ref, square, style }: CustomSquareProps) {
      return (
        <div ref={ref} style={{ ...style, position: 'relative' }}>
          {children}
          {square === glyphSq && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                color: meta.hex,
                textShadow: '0 0 3px rgba(0,0,0,0.9)',
                pointerEvents: 'none',
                zIndex: 20,
                userSelect: 'none',
              }}
            >
              {meta.symbol}
            </span>
          )}
        </div>
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyphSquare?.square, glyphSquare?.quality]);

  return customSquare;
}
