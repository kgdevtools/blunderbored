import { PuzzleGeneratorShell } from '@/components/puzzle-generator/PuzzleGeneratorShell';

export default async function PuzzleGeneratorPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string }>;
}) {
  const { pgn } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-2 md:p-8">
      <div className="w-full max-w-5xl">
        <PuzzleGeneratorShell initialPgn={typeof pgn === 'string' ? pgn : undefined} />
      </div>
    </main>
  );
}
