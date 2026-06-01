'use client';
import { useState, useEffect } from 'react';
import { Chessboard } from '@zoendev/react-chessboard';

export default function TestBoard() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [boardWidth, setBoardWidth] = useState(400);

  useEffect(() => {
    const updateWidth = () => {
      if (window.innerWidth < 768) {
        setBoardWidth(Math.min(400, window.innerWidth - 32));
      } else {
        setBoardWidth(400);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-8">
      <h1 className="text-2xl font-bold">Test Board v2</h1>
      
      <div className="flex gap-4">
        <button 
          onClick={() => setFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          e4 e5
        </button>
        <button 
          onClick={() => setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')}
          className="px-4 py-2 bg-gray-600 text-white rounded"
        >
          Reset
        </button>
      </div>

      <div className="text-sm">FEN: {fen}</div>

      <div className="w-full max-w-[400px]">
        <Chessboard 
          position={fen} 
          boardWidth={boardWidth} 
        />
      </div>
    </main>
  );
}
