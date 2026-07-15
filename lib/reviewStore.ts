// Persistence for finished game reviews: LibraryGame.reviewData (Dexie).
//
// The field has existed since schema v1 but nothing ever wrote it — every
// re-open re-ran the full engine pass and the analysed-games counter stayed
// at 0. This module closes the loop: after a successful analysis the review is
// written back to the matching library game (found by movetext fingerprint),
// and on load a stored review with a matching fingerprint + current schema
// version short-circuits the engine entirely.
//
// No schema bump: reviewData is an unindexed value field (Dexie migrations
// must stay additive — see project rules).

import { db, type LibraryGame } from './db';
import { movesFingerprint } from './library';
import { REVIEW_SCHEMA_VERSION, type GameReview, type MoveQuality, type SideSummary } from './analysis';

export interface StoredReviewHit {
  game:   LibraryGame;
  review: GameReview;
}

// The stored review is usable only when it's the current schema and the
// movetext hasn't changed. (Older stored objects — pre-v2, no meta — display
// fine through normalizeStoredReview but never short-circuit a fresh analysis.)
export async function loadStoredReview(pgn: string): Promise<StoredReviewHit | null> {
  const fp = movesFingerprint(pgn);
  const game = await findGameByFingerprint(fp);
  if (!game?.reviewData) return null;
  const review = game.reviewData;
  if (review.meta?.version !== REVIEW_SCHEMA_VERSION) return null;
  return { game, review: normalizeStoredReview(review) };
}

// Write a finished review back to the matching library game (no-op when the
// PGN isn't in the library — direct pastes are reviewable without saving).
export async function saveReviewForPgn(pgn: string, review: GameReview): Promise<string | null> {
  const game = await findGameByFingerprint(movesFingerprint(pgn));
  if (!game) return null;
  await db.games.update(game.id, { reviewData: review, updatedAt: Date.now() });
  return game.id;
}

// Fingerprint scan. The field is unindexed by design (small table; the
// library's dedupe pipeline does the same full scan on every import).
export async function findGameByFingerprint(fp: string): Promise<LibraryGame | null> {
  const games = await db.games.toArray();
  return games.find((g) => (g.fingerprint ?? movesFingerprint(g.pgn)) === fp) ?? null;
}

const ALL_TIER_KEYS: MoveQuality[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'miss', 'blunder', 'forced',
];

// Shield readers from older stored shapes: backfill missing tier-count keys
// (5-tier era) so Record<MoveQuality, number> consumers never see undefined.
export function normalizeStoredReview(review: GameReview): GameReview {
  const fill = (s: SideSummary): SideSummary => {
    const counts = { ...s.counts };
    for (const k of ALL_TIER_KEYS) counts[k] ??= 0;
    return { ...s, counts };
  };
  return {
    ...review,
    whiteSummary: fill(review.whiteSummary),
    blackSummary: fill(review.blackSummary),
  };
}
