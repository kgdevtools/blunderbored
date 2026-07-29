import { redirect } from 'next/navigation';

export default async function AnalysisRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ pgn?: string }>;
}) {
  const { pgn } = await searchParams;
  const target = pgn ? `/puzzle-generator?pgn=${encodeURIComponent(pgn)}` : '/puzzle-generator';
  redirect(target);
}
