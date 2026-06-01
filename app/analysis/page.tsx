import { redirect } from 'next/navigation';

export default async function AnalysisRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string }>;
}) {
  const { pgn } = await searchParams;
  const target = pgn ? `/game-reviewer?pgn=${encodeURIComponent(pgn)}` : '/game-reviewer';
  redirect(target);
}
