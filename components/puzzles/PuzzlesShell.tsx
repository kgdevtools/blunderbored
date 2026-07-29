'use client';
// Dedicated Puzzles page. No workoutId → Create (always an editable board +
// the Puzzle Set/Moves/Settings panel). workoutId → Solve a saved set;
// workoutId + previewPuzzleId → the same viewer relabelled Preview, jumped to
// that puzzle, launched from the Creator to test a puzzle before it's final.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, type Puzzle, type WorkoutSet } from '@/lib/db';
import { CreatePuzzleShell } from './CreatePuzzleShell';
import { SolveSetMode } from './SolveSetMode';
import { devlog } from '@/lib/devlog';

interface ActiveSet {
  name: string;
  puzzles: Puzzle[];
  timerSeconds?: number;
}

interface PuzzlesShellProps {
  workoutId?: string;
  previewPuzzleId?: string;
  openSetId?: string;
}

export function PuzzlesShell({ workoutId, previewPuzzleId, openSetId }: PuzzlesShellProps) {
  const router = useRouter();
  const [activeSet, setActiveSet] = useState<ActiveSet | null>(null);
  const [loading, setLoading] = useState(!!workoutId);

  const loadSet = (set: WorkoutSet) => {
    setLoading(true);
    db.puzzles.bulkGet(set.puzzleIds)
      .then((puzzles) => {
        setActiveSet({ name: set.name, puzzles: puzzles.filter((p): p is Puzzle => !!p), timerSeconds: set.timerSeconds });
        setLoading(false);
      })
      .catch((e) => {
        devlog('tactics', 'workout load failed', { workoutId: set.id, error: String(e) });
        setLoading(false);
      });
  };

  const initApplied = useRef(false);
  useEffect(() => {
    if (initApplied.current || !workoutId) return;
    initApplied.current = true;
    db.workoutSets.get(workoutId).then((set) => {
      if (set) loadSet(set);
      else setLoading(false);
    });
  }, [workoutId]);

  const handleExit = () => {
    setActiveSet(null);
    router.push('/puzzles');
  };

  // Preview's "back to editing" / "Confirm" both just return to the Creator
  // with the same set reopened — the puzzle was already saved before this
  // viewer was launched (CreatePuzzleShell.handlePreview saves first).
  const handleBackToEditing = () => {
    router.push(`/puzzles?openSetId=${workoutId}`);
  };

  if (loading) return <p className="p-6 text-center text-sm text-zinc-400">Loading…</p>;

  if (activeSet) {
    if (activeSet.puzzles.length === 0) {
      return (
        <div className="p-6 text-center text-sm text-zinc-400">
          This workout&rsquo;s puzzles are gone (deleted?).
          <button
            onClick={handleExit}
            className="block mx-auto mt-2 text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            Back to puzzles
          </button>
        </div>
      );
    }
    const isPreview = !!previewPuzzleId;
    // Always start at the first puzzle (1/N) — whether Solving or Previewing
    // — so the solver always works through a set from the beginning rather
    // than being dropped into the middle at whatever was last saved/tested.
    return (
      <div className="flex flex-col gap-3 w-full">
        <h1 className="px-1 text-lg font-bold tracking-tight text-zinc-100">{activeSet.name}</h1>
        <SolveSetMode
          puzzles={activeSet.puzzles}
          onExit={isPreview ? handleBackToEditing : handleExit}
          mode={isPreview ? 'preview' : 'solve'}
          initialIndex={0}
          setTimerSeconds={activeSet.timerSeconds}
        />
      </div>
    );
  }

  return <CreatePuzzleShell initialOpenSetId={openSetId} />;
}
