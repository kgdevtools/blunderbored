'use client';
// Library → Workouts tab: saved puzzle sets from the Puzzle Generator.
// Solve routes into the generator's solve mode; Delete removes the set only
// (its puzzles stay in the pool for learn-from-mistakes).

import { useEffect, useState } from 'react';
import { db, type WorkoutSet } from '@/lib/db';

export function WorkoutsList({ onSolve }: { onSolve: (set: WorkoutSet) => void }) {
  const [sets, setSets] = useState<WorkoutSet[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const reload = () => {
    db.workoutSets.orderBy('createdAt').reverse().toArray().then(setSets).catch(() => setSets([]));
  };
  useEffect(reload, []);

  if (sets === null) return <p className="p-4 text-xs text-zinc-500">Loading…</p>;

  if (sets.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-500 text-xs leading-relaxed">
        No workouts yet.<br />
        Generate puzzles from a game (Game Analysis) and use <span className="text-zinc-300">Save Set</span>.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1">
      {sets.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 px-3 py-2 rounded bg-zinc-800/60 border border-zinc-800 hover:border-zinc-700 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-100 font-medium truncate">{s.name}</p>
            <p className="text-[11px] text-zinc-500 tabular-nums">
              {s.puzzleIds.length} puzzle{s.puzzleIds.length === 1 ? '' : 's'} ·{' '}
              {new Date(s.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => onSolve(s)}
            className="shrink-0 px-2.5 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
          >
            Solve
          </button>
          {confirmingId === s.id ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px]">
              <button
                onClick={() => { db.workoutSets.delete(s.id).then(reload); setConfirmingId(null); }}
                className="text-red-400 hover:text-red-300 font-medium"
              >
                Confirm
              </button>
              <button onClick={() => setConfirmingId(null)} className="text-zinc-500 hover:text-zinc-300">
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingId(s.id)}
              className="shrink-0 px-2 py-1 rounded text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
              title="Delete this workout (puzzles stay in the practice pool)"
            >
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
