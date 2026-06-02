import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline — Chess Academy',
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div
        aria-hidden
        className="grid h-16 w-16 grid-cols-2 grid-rows-2 overflow-hidden rounded-xl"
      >
        <span className="bg-slate-200" />
        <span className="bg-slate-600" />
        <span className="bg-slate-600" />
        <span className="bg-slate-200" />
      </div>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm opacity-70">
        This page hasn&apos;t been cached yet. Pages you&apos;ve already visited
        — including the analysis board — still work without a connection.
      </p>
      <Link
        href="/board"
        className="rounded-md border border-current px-4 py-2 text-sm font-medium hover:opacity-80"
      >
        Go to the board
      </Link>
    </main>
  );
}
