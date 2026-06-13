'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SavedPosition } from '@/lib/db';
import { deleteSavedPosition, updateSavedPosition, usePositionsForConcept } from '@/lib/positions';
import { ConceptTagEditor } from './SavedPositions';

// Lightweight static board thumbnail from a FEN placement (no react-chessboard
// instance per card — cheap to render many).
const GLYPH: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};
function MiniBoard({ fen, size = 132 }: { fen: string; size?: number }) {
  const placement = fen.split(' ')[0] ?? '';
  const rows = placement.split('/');
  const cell = size / 8;
  const squares: React.ReactNode[] = [];
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const dark = (r + file) % 2 === 1;
      const white = ch === ch.toUpperCase();
      squares.push(
        <div key={`${r}-${file}`} className="absolute grid place-items-center" style={{ left: file * cell, top: r * cell, width: cell, height: cell, background: dark ? '#8a7a5c' : '#d8cba8' }}>
          <span style={{ fontSize: cell * 0.82, lineHeight: 1, color: white ? '#fafafa' : '#18181b', textShadow: white ? '0 0 1px #000' : 'none' }}>{GLYPH[ch] ?? ''}</span>
        </div>,
      );
      file += 1;
    }
  }
  return (
    <div className="relative rounded-sm overflow-hidden shrink-0" style={{ width: size, height: size, background: '#d8cba8' }}>
      {/* base checkerboard for empty squares */}
      {Array.from({ length: 64 }).map((_, i) => {
        const r = Math.floor(i / 8), c = i % 8;
        return <div key={i} className="absolute" style={{ left: c * cell, top: r * cell, width: cell, height: cell, background: (r + c) % 2 === 1 ? '#8a7a5c' : '#d8cba8' }} />;
      })}
      {squares}
    </div>
  );
}

function fmtClockShort(ms?: number) { return ms ? `${Math.round(ms / 60000)}m` : ''; }

function PositionCard({ pos, onPractice }: { pos: SavedPosition; onPractice: (p: SavedPosition) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(pos.title);
  const [note, setNote] = useState(pos.note ?? '');

  const saveEdits = () => { updateSavedPosition(pos.id, { title: title.trim() || 'Untitled position', note: note.trim() || undefined }); setEditing(false); };

  return (
    <div className="flex gap-3 p-3 rounded-md border border-zinc-800 bg-zinc-900/40">
      <MiniBoard fen={pos.fen} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-2 py-1 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm" autoFocus />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-zinc-100 truncate">{pos.title}</span>
            <span className="text-[10px] text-zinc-500 shrink-0">{pos.side === 'w' ? 'White' : 'Black'}{pos.ratingElo ? ` · ${pos.ratingElo}` : ''}{pos.clockInitialMs ? ` · ${fmtClockShort(pos.clockInitialMs)}` : ''}</span>
          </div>
        )}

        {editing ? (
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note" className="w-full px-2 py-1 rounded-sm bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs resize-none" />
        ) : (
          pos.note && <p className="text-xs text-zinc-400 line-clamp-2">{pos.note}</p>
        )}

        <ConceptTagEditor positionId={pos.id} />

        <div className="flex items-center gap-2 mt-auto pt-1">
          <button onClick={() => onPractice(pos)} className="px-3 py-1 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">Practice</button>
          {editing ? (
            <button onClick={saveEdits} className="px-2 py-1 rounded-sm bg-emerald-700 hover:bg-emerald-600 text-white text-xs">Done</button>
          ) : (
            <button onClick={() => { setTitle(pos.title); setNote(pos.note ?? ''); setEditing(true); }} className="px-2 py-1 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs">Edit</button>
          )}
          {pos.timesPracticed ? <span className="text-[10px] text-zinc-600">{pos.timesPracticed}× · {pos.lastResult === 'succeeded' ? 'held' : 'failed'}</span> : null}
          <button onClick={() => { if (confirm(`Delete “${pos.title}”?`)) deleteSavedPosition(pos.id); }} className="ml-auto text-zinc-600 hover:text-red-400 text-xs px-1">Delete</button>
        </div>
      </div>
    </div>
  );
}

// Browse, tag and manage saved positions. Reused by the /positions route and the
// library modal's Positions tab. `onPractice` deep-links into a drill.
export function PositionsManager({ onPractice }: { onPractice: (p: SavedPosition) => void }) {
  // `name` isn't indexed on conceptNodes — fetch all and sort in JS.
  const allConcepts = useLiveQuery(async () => (await db.conceptNodes.toArray()).sort((a, b) => a.name.localeCompare(b.name)), []) ?? [];
  const [filter, setFilter] = useState<string | null>(null);
  const positions = usePositionsForConcept(filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500">{positions.length} position{positions.length === 1 ? '' : 's'}</span>
        <select value={filter ?? 'all'} onChange={(e) => setFilter(e.target.value === 'all' ? null : e.target.value)}
          className="ml-auto px-2 py-1 rounded-sm bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500">
          <option value="all">All concepts</option>
          {allConcepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {positions.length === 0 ? (
        <p className="text-sm text-zinc-600 py-8 text-center">No saved positions{filter ? ' for this concept' : ' yet'}. Save one from a Blunderable challenge or the board.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {positions.map((p) => <PositionCard key={p.id} pos={p} onPractice={onPractice} />)}
        </div>
      )}
    </div>
  );
}
