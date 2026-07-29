import { PuzzlesShell } from '@/components/puzzles/PuzzlesShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { DevConsole } from '@/components/dev/DevConsole';

export default async function PuzzlesPage({
  searchParams,
}: {
  searchParams: Promise<{ workoutId?: string; previewPuzzleId?: string; openSetId?: string }>;
}) {
  const { workoutId, previewPuzzleId, openSetId } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-2 md:p-8">
      <div className="w-full max-w-5xl">
        <ErrorBoundary>
          <PuzzlesShell
            workoutId={typeof workoutId === 'string' ? workoutId : undefined}
            previewPuzzleId={typeof previewPuzzleId === 'string' ? previewPuzzleId : undefined}
            openSetId={typeof openSetId === 'string' ? openSetId : undefined}
          />
        </ErrorBoundary>
      </div>
      <DevConsole />
    </main>
  );
}
