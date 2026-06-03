import { ReviewerShell } from '@/components/game-reviewer/ReviewerShell';

export default async function GameReviewerPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string }>;
}) {
  const { pgn } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-5xl">
        <ReviewerShell initialPgn={typeof pgn === 'string' ? pgn : undefined} />
      </div>
    </main>
  );
}
