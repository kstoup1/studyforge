/**
 * Pure, dependency-free dashboard calculations -- same pattern as src/lib/sm2/sm2.ts:
 * no Prisma/Next imports, `now` passed in rather than read internally, so these are
 * fully deterministic and unit-tested independently of any database.
 */

import { localDayKey, previousDayKey } from "@/lib/dates/time-zone";

/**
 * Consecutive days (ending today or yesterday) with at least one review, where
 * "day" is the calendar day in the user's `timeZone` (default UTC). Reviewing
 * "later today" doesn't retroactively break a streak from yesterday -- the streak
 * only breaks once a full day passes with zero reviews. `reviewDates` can be in any
 * order and contain multiple reviews per day.
 */
export function computeStreak(
  reviewDates: Date[],
  now: Date = new Date(),
  timeZone: string = "UTC",
): number {
  if (reviewDates.length === 0) return 0;

  const days = new Set(reviewDates.map((d) => localDayKey(d, timeZone)));
  const today = localDayKey(now, timeZone);
  const yesterday = previousDayKey(today);

  let cursor: string;
  if (days.has(today)) {
    cursor = today;
  } else if (days.has(yesterday)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
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
