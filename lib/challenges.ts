'use client';
import { nanoid } from 'nanoid';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ChallengeReport } from './db';

const MAX_HISTORY = 50;

// Persist a finished challenge and trim the history to the most recent N.
export async function saveChallenge(input: Omit<ChallengeReport, 'id' | 'createdAt'>): Promise<void> {
  const report: ChallengeReport = { ...input, id: nanoid(), createdAt: Date.now() };
  await db.challenges.add(report);

  const all = await db.challenges.orderBy('createdAt').reverse().toArray();
  if (all.length > MAX_HISTORY) {
    await db.challenges.bulkDelete(all.slice(MAX_HISTORY).map((c) => c.id));
  }
}

// Recent challenges, newest first.
export function useRecentChallenges(limit = 8): ChallengeReport[] {
  return useLiveQuery(
    () => db.challenges.orderBy('createdAt').reverse().limit(limit).toArray(),
    [limit],
  ) ?? [];
}
