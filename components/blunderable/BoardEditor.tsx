'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from '@zoendev/react-chessboard';
import type { Square as CbSquare } from '@zoendev/react-chessboard/dist/chessboard/types/index';
import { normalizeFen } from '@/lib/gameTree';

// Compact position editor: place pieces (click/drag), undo/reset/clear/erase, and
// — when a PGN is loaded — a /board-style ply-nav row sits UNDER the board. No
// card chrome. A side-to-move radio overlays the board's top-right corner.

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_LABELS: Record<string, string> = {
  P: 'White Pawn', N: 'White Knight', B: 'White Bishop', R: 'White Rook', Q: 'White Queen', K: 'White King',
  p: 'Black Pawn', n: 'Black Knight', b: 'Black Bishop', r: 'Black Rook', q: 'Black Queen', k: 'Black King',
};

function loadLoose(fen: string): Chess {
  const g = new Chess();
  try { g.load(normalizeFen(fen), { skipValidation: true } as Parameters<Chess['load']>[1]); } catch { g.reset(); }
  return g;
}

export interface PlyNav {
  index: number;
  count: number;       // last ply index (fens.length - 1)
  label: string;       // e.g. "12. Nf3"
  goto: (i: number) => void;
}

function PieceButton({ piece, selected, onSelect }: { piece: string; selected: string | null; onSelect: (p: string) => void }) {
  const isWhite = piece === piece.toUpperCase();
  const isSel = selected === piece;
  return (
    <button
      onClick={() => onSelect(piece)}
      title={PIECE_LABELS[piece]}
      className={[
        'w-6 h-6 rounded-sm flex items-center justify-center text-xs font-bold border transition-all',
        isSel ? 'ring-2 ring-zinc-100 border-transparent' : 'border-transparent hover:opacity-80',
      ].join(' ')}
      style={{ color: isWhite ? '#18181b' : '#f4f4f5', backgroundColor: isWhite ? '#e4e4e7' : '#3f3f46' }}
    >
      {piece.toUpperCase()}
    </button>
  );
}

const navBtn = 'flex-1 py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-25 disabled:cursor-not-allowed text-zinc-200 text-sm transition-colors';
const toolBtn = 'px-2 py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] transition-colors';

export function BoardEditor({ fen, onFenChange, orientation, onFlip, ply, maxBoard = 460 }: {
  fen: string;
  onFenChange: (fen: string) => void;
  orientation: 'white' | 'black';
  onFlip: () => void;
  ply?: PlyNav | null;
  maxBoard?: number;
}) {
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null);
  const [, setHistory] = useState<string[]>([fen]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (w: number) => { if (w > 0) setBoardWidth(Math.min(Math.floor(w), maxBoard)); };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxBoard]);

  useEffect(() => {
    setHistory((h) => (h[h.length - 1] === fen ? h : [...h, fen].slice(-30)));
  }, [fen]);

  const game = useMemo(() => loadLoose(fen), [fen]);
  const whiteToMove = game.turn() === 'w';

  const commit = useCallback((next: string) => { onFenChange(next); }, [onFenChange]);

  const handleSquareClick = useCallback((square: CbSquare) => {
    if (!selectedPiece) return;
    const g = loadLoose(fen);
    g.remove(square);
    if (selectedPiece !== 'erase') {
      g.put({ type: selectedPiece.toLowerCase() as 'p' | 'n' | 'b' | 'r' | 'q' | 'k', color: selectedPiece === selectedPiece.toUpperCase() ? 'w' : 'b' }, square);
    }
    commit(g.fen());
  }, [fen, selectedPiece, commit]);

  const handlePieceDrop = useCallback((from: CbSquare, to: CbSquare): boolean => {
    const g = loadLoose(fen);
    const piece = g.get(from);
    if (!piece) return false;
    g.remove(from);
    g.put(piece, to);
    commit(g.fen());
    return true;
  }, [fen, commit]);

  const undo = () => {
    setHistory((h) => {
      if (h.length < 2) return h;
      const next = h.slice(0, -1);
      commit(next[next.length - 1]);
      return next;
    });
  };

  const toggleSideToMove = () => {
    const parts = fen.split(' ');
    parts[1] = parts[1] === 'b' ? 'w' : 'b';
    commit(parts.join(' '));
  };

  const whitePieces = ['P', 'N', 'B', 'R', 'Q', 'K'];
  const blackPieces = ['p', 'n', 'b', 'r', 'q', 'k'];

  return (
    <div className="space-y-2">
      {/* Board with side-to-move radio overlay (top-right) */}
      <div ref={containerRef} className="relative w-full mx-auto" style={{ maxWidth: maxBoard, aspectRatio: '1 / 1' }}>
        {boardWidth > 0 && (
          <Chessboard
            position={fen}
            boardWidth={boardWidth}
            boardOrientation={orientation}
            onSquareClick={handleSquareClick}
            onPieceDrop={handlePieceDrop}
            areArrowsAllowed={false}
            customBoardStyle={{ borderRadius: '4px' }}
          />
        )}
        <button
          onClick={toggleSideToMove}
          title={`${whiteToMove ? 'White' : 'Black'} to move — click to toggle`}
          className={[
            'absolute top-1.5 right-1.5 w-6 h-6 rounded-sm border shadow-md transition-colors',
            whiteToMove ? 'bg-zinc-100 border-zinc-400' : 'bg-zinc-900 border-zinc-600',
          ].join(' ')}
          aria-label={`${whiteToMove ? 'White' : 'Black'} to move`}
        />
      </div>

      {/* /board-style control row UNDER the board: ply nav (if a PGN is loaded) + flip */}
      <div className="flex gap-0.5">
        {ply && (
          <>
            <button className={navBtn} onClick={() => ply.goto(0)} disabled={ply.index === 0} title="Start">⟨⟨</button>
            <button className={navBtn} onClick={() => ply.goto(ply.index - 1)} disabled={ply.index === 0} title="Previous">⟨</button>
            <button className={navBtn} onClick={() => ply.goto(ply.index + 1)} disabled={ply.index >= ply.count} title="Next">⟩</button>
            <button className={navBtn} onClick={() => ply.goto(ply.count)} disabled={ply.index >= ply.count} title="End">⟩⟩</button>
          </>
        )}
        <button className={navBtn} onClick={onFlip} title="Flip board">⇅</button>
      </div>
      {ply && (
        <div className="text-[11px] text-zinc-500 tabular-nums text-center">
          Ply {ply.index}/{ply.count}{ply.label && <span className="ml-1.5 font-mono text-zinc-300">{ply.label}</span>}
        </div>
      )}

      {/* Compact editor tools — all inline */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={toolBtn} onClick={undo}>Undo</button>
        <button className={toolBtn} onClick={() => commit(START_FEN)}>Reset</button>
        <button className={toolBtn} onClick={() => commit(EMPTY_FEN)}>Clear</button>
        <span className="w-px h-5 bg-zinc-800 mx-0.5" />
        <div className="flex gap-1">{whitePieces.map((p) => <PieceButton key={p} piece={p} selected={selectedPiece} onSelect={(x) => setSelectedPiece(x === selectedPiece ? null : x)} />)}</div>
        <div className="flex gap-1">{blackPieces.map((p) => <PieceButton key={p} piece={p} selected={selectedPiece} onSelect={(x) => setSelectedPiece(x === selectedPiece ? null : x)} />)}</div>
        <button
          onClick={() => setSelectedPiece(selectedPiece === 'erase' ? null : 'erase')}
          className={selectedPiece === 'erase' ? 'px-2 py-1.5 rounded-sm bg-zinc-100 text-zinc-900 text-[11px] font-semibold' : toolBtn}
        >
          Erase
        </button>
      </div>
    </div>
  );
}
