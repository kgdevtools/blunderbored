import { BlunderableShell } from '@/components/blunderable/BlunderableShell';

export default async function BlunderablePage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string }>;
}) {
  const { pos } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-4 md:p-6">
      <div className="w-full max-w-6xl">
        <BlunderableShell initialPositionId={typeof pos === 'string' ? pos : undefined} />
      </div>
    </main>
  );
}
