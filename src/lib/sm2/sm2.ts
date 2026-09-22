/**
 * SM-2 spaced-repetition scheduling (the algorithm behind Anki/SuperMemo 2).
 *
 * Pure, deterministic, zero framework dependencies (no Prisma, no Next.js) so it's
 * trivially unit-testable and independently reusable — see sm2.test.ts. `now` is
 * always passed in rather than read internally, so a given input always produces
 * the same output.
 *
 * Reference: https://super-memory.com/english/ol/sm2.htm
 */

export interface SM2Input {
  /** Current ease factor (starts at 2.5 for a brand-new card). */
  easeFactor: number;
  /** Current interval in days before this review (0 for a never-reviewed card). */
  intervalDays: number;
  /** Consecutive correct repetitions so far (0 for a never-reviewed card, or after a lapse). */
  repetitions: number;
  /** Quality of recall for this review, 0 (total blackout) to 5 (perfect recall). */
  grade: number;
}

export interface SM2Result {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: Date;
}

/** SM-2 never lets the ease factor drop below this, however many lapses occur. */
export const MIN_EASE_FACTOR = 1.3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeNextSchedule(input: SM2Input, now: Date = new Date()): SM2Result {
  const { easeFactor, intervalDays, repetitions, grade } = input;

  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new RangeError(`grade must be an integer 0-5, got ${grade}`);
  }

  let newRepetitions: number;
  let newIntervalDays: number;

  if (grade >= 3) {
    // Correct recall: interval grows 1 -> 6 -> previous*EF, repetitions increments.
    if (repetitions === 0) {
      newIntervalDays = 1;
    } else if (repetitions === 1) {
      newIntervalDays = 6;
    } else {
      newIntervalDays = Math.round(intervalDays * easeFactor);
    }
    newRepetitions = repetitions + 1;
  } else {
    // A lapse resets progress entirely, but — per the original algorithm — does NOT
    // reset the ease factor; only the formula below (applied unconditionally) does.
    newRepetitions = 0;
    newIntervalDays = 1;
  }

  let newEaseFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  if (newEaseFactor < MIN_EASE_FACTOR) {
    newEaseFactor = MIN_EASE_FACTOR;
  }

  const nextDueAt = new Date(now.getTime() + newIntervalDays * MS_PER_DAY);

  return {
    easeFactor: newEaseFactor,
    intervalDays: newIntervalDays,
    repetitions: newRepetitions,
    nextDueAt,
  };
}
