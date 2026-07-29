'use client';
// Workouts tab (first tab): browse/open/solve/delete saved puzzle sets, and
// "+ New Workout" — name + optional time allocation for the whole set,
// decided once here rather than per-puzzle (see PuzzleEditTab).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, type WorkoutSet } from '@/lib/db';

const TIMER_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'No timer', seconds: null },
  { label: '3 min', seconds: 180 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

function fmtTimer(seconds?: number): string {
  if (!seconds) return 'No timer';
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

interface WorkoutsTabProps {
  openSetId: string | null;
  onOpenSet: (setId: string) => void;
  onNewSet: (name: string, timerSeconds: number | null) => void;
}

export function WorkoutsTab({ openSetId, onOpenSet, onNewSet }: WorkoutsTabProps) {
  const router = useRouter();
  const [sets, setSets] = useState<WorkoutSet[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTimer, setNewTimer] = useState<number | null>(null);

  const reloadSets = () => {
    db.workoutSets.orderBy('createdAt').reverse().toArray().then(setSets).catch(() => setSets([]));
  };
  useEffect(reloadSets, [openSetId]);

  const handleDeleteSet = (id: string) => {
    db.workoutSets.delete(id).then(reloadSets);
  };

  const submitNewSet = () => {
    onNewSet(newName, newTimer);
    setShowNewForm(false);
    setNewName('');
    setNewTimer(null);
  };

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {!showNewForm ? (
        <button
          onClick={() => setShowNewForm(true)}
          className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          + New Workout
        </button>
      ) : (
        <div className="flex flex-col gap-2 p-2.5 rounded bg-zinc-800/60 border border-zinc-700">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Name</label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitNewSet(); }}
              placeholder={`Puzzle set — ${new Date().toLocaleDateString()}`}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Time allocated (whole set)</label>
            <div className="grid grid-cols-4 gap-1">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setNewTimer(opt.seconds)}
                  className={`py-1.5 rounded text-xs font-medium transition-colors ${
                    newTimer === opt.seconds ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-1.5 pt-0.5">
            <button onClick={() => setShowNewForm(false)} className="px-2.5 py-1 rounded text-xs bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300">Cancel</button>
            <button onClick={submitNewSet} className="px-2.5 py-1 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Create</button>
          </div>
        </div>
      )}

      {sets === null ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : sets.length === 0 ? (
        <p className="text-xs text-zinc-500 leading-relaxed px-1">
          No puzzle sets yet — create one above, or use Game Analysis to generate one from a game.
        </p>
      ) : (
        sets.map((s) => (
          <div key={s.id} className="flex items-center gap-2 px-2.5 py-2 rounded bg-zinc-800/60 border border-zinc-800 hover:border-zinc-700 transition-colors min-w-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-100 font-medium truncate">{s.name}</p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                {s.puzzleIds.length} puzzle{s.puzzleIds.length === 1 ? '' : 's'} · {fmtTimer(s.timerSeconds)}
              </p>
            </div>
            <button onClick={() => onOpenSet(s.id)} className="shrink-0 px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-medium transition-colors">
              Open
            </button>
            <button
              onClick={() => router.push(`/puzzles?workoutId=${s.id}`)}
              className="shrink-0 px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Solve
            </button>
            {confirmingId === s.id ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px]">
                <button onClick={() => handleDeleteSet(s.id)} className="text-red-400 hover:text-red-300 font-medium">Confirm</button>
                <button onClick={() => setConfirmingId(null)} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmingId(s.id)} className="shrink-0 px-1.5 py-1 rounded text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
                🗑
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
