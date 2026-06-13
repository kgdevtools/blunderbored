'use client';
import { useRouter } from 'next/navigation';
import { PositionsManager } from '@/components/blunderable/PositionsManager';

export default function PositionsPage() {
  const router = useRouter();
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-4 md:p-6">
      <div className="w-full max-w-5xl mx-auto p-4">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Saved positions</h1>
            <p className="text-sm text-zinc-500 mt-1">Practice and study positions, organised by concept.</p>
          </div>
          <a href="/blunderable" className="text-sm text-indigo-400 hover:text-indigo-300 shrink-0">New challenge →</a>
        </div>
        <PositionsManager onPractice={(p) => router.push(`/blunderable?pos=${p.id}`)} />
      </div>
    </main>
  );
}
