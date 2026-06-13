'use client';
import { useRouter } from 'next/navigation';
import { PositionsManager } from '@/components/blunderable/PositionsManager';
import { BackupControls } from '@/components/common/BackupControls';

export default function PositionsPage() {
  const router = useRouter();
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-4 md:p-6">
      <div className="w-full max-w-5xl mx-auto p-4">
        <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Saved positions</h1>
            <p className="text-sm text-zinc-500 mt-1">Practice and study positions, organised by concept.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <BackupControls />
            <a href="/blunderable" className="text-sm text-indigo-400 hover:text-indigo-300">New challenge →</a>
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 mb-3">Back up / restore covers your whole library — games, positions, concepts, graph &amp; history.</p>
        <PositionsManager onPractice={(p) => router.push(`/blunderable?pos=${p.id}`)} />
      </div>
    </main>
  );
}
