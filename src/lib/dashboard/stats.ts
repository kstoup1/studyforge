/**
 * Pure, dependency-free dashboard calculations -- same pattern as src/lib/sm2/sm2.ts:
 * no Prisma/Next imports, `now` passed in rather than read internally, so these are
 * fully deterministic and unit-tested independently of any database.
 */

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC) -- deterministic for tests
}

/**
 * Consecutive days (ending today or yesterday) with at least one review.
 * Reviewing "later today" doesn't retroactively break a streak from yesterday --
 * the streak only breaks once a full day passes with zero reviews. `reviewDates`
 * can be in any order and contain multiple reviews per day.
 */
export function computeStreak(reviewDates: Date[], now: Date = new Date()): number {
  if (reviewDates.length === 0) return 0;

  const days = new Set(reviewDates.map(dayKey));
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  let cursor: Date;
  if (days.has(today)) {
    cursor = now;
  } else if (days.has(yesterday)) {
    cursor = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else {
    return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

/** A card counts as "mastered" once it's demonstrated enough spaced-out recall:
 * either 2+ consecutive correct reviews, or an interval of 21+ days (SM-2's
 * interval grows quickly on success -- 21 days typically means several correct
 * reviews already happened even if `repetitions` was reset by an intervening
 * lapse and hasn't climbed back up yet). */
export function isMastered(card: { repetitions: number; intervalDays: number }): boolean {
  return card.repetitions >= 2 || card.intervalDays >= 21;
}

export function computeMasteryPercent(
  cards: { repetitions: number; intervalDays: number }[],
): number {
  if (cards.length === 0) return 0;
  const mastered = cards.filter(isMastered).length;
  return Math.round((mastered / cards.length) * 100);
}
