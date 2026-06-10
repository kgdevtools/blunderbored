import { BoardShell } from '@/components/board/BoardShell';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string; fen?: string }>;
}) {
  const { pgn, fen } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-2 md:p-6">
      <div className="w-full max-w-6xl">
        <BoardShell
          initialPgn={typeof pgn === 'string' ? pgn : undefined}
          initialFen={typeof fen === 'string' ? fen : undefined}
        />
      </div>
    </main>
  );
}
