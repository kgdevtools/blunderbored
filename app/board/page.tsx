import { BoardShell } from '@/components/board/BoardShell';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string; fen?: string }>;
}) {
  const { pgn, fen } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-6">
      <h1 className="text-3xl font-bold mb-6 text-center w-full">Board</h1>
      <div className="w-full max-w-6xl">
        <BoardShell
          initialPgn={typeof pgn === 'string' ? pgn : undefined}
          initialFen={typeof fen === 'string' ? fen : undefined}
        />
      </div>
    </main>
  );
}
