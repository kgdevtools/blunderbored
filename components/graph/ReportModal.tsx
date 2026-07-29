'use client';
// Wraps GameReport in a modal shell — Report used to swap in place of the
// move list; now it opens as an overlay so the board/move list stay put.
// GameReport already renders its own header (title + close), so this only
// supplies the backdrop and sizing.

import { useEffect, useRef } from 'react';
import type { GameReview } from '@/lib/analysis';
import { GameReport } from './GameReport';

interface ReportModalProps {
  review: GameReview;
  originalPgn: string;
  currentMoveIndex: number;
  onSelectMove: (i: number) => void;
  onClose: () => void;
}

export function ReportModal({ review, originalPgn, currentMoveIndex, onSelectMove, onClose }: ReportModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (!dialogRef.current?.contains(e.target as Node)) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        className="bg-zinc-900 rounded-lg w-full max-w-lg h-[85vh] max-h-[720px] shadow-2xl border border-zinc-700 p-3"
      >
        <GameReport
          review={review}
          originalPgn={originalPgn}
          currentMoveIndex={currentMoveIndex}
          onSelectMove={onSelectMove}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
