import { LearnFromMistakesShell } from '@/components/learn-from-mistakes/LearnFromMistakesShell';

export default function LearnFromMistakesPage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-0 py-2 md:p-8">
      <div className="w-full max-w-3xl">
        <LearnFromMistakesShell />
      </div>
    </main>
  );
}
