import { describe, expect, it } from "vitest";
import { computeNextSchedule, MIN_EASE_FACTOR, type SM2Input } from "./sm2";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const freshCard: SM2Input = { easeFactor: 2.5, intervalDays: 0, repetitions: 0, grade: 5 };

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

describe("computeNextSchedule — input validation", () => {
  it.each([-1, 6, 2.5, NaN])("rejects an out-of-range grade (%s)", (grade) => {
    expect(() => computeNextSchedule({ ...freshCard, grade }, NOW)).toThrow(RangeError);
  });

  it.each([0, 1, 2, 3, 4, 5])("accepts every valid grade (%s)", (grade) => {
    expect(() => computeNextSchedule({ ...freshCard, grade }, NOW)).not.toThrow();
  });
});

describe("computeNextSchedule — first review of a brand-new card", () => {
  it.each([
    [0, 0, 1, 1.7],
    [1, 0, 1, 1.96],
    [2, 0, 1, 2.18],
    [3, 1, 1, 2.36],
    [4, 1, 1, 2.5],
    [5, 1, 1, 2.6],
  ])("grade %i -> repetitions=%i, interval=%i days, EF≈%f", (grade, reps, interval, ef) => {
    const result = computeNextSchedule(
      { easeFactor: 2.5, intervalDays: 0, repetitions: 0, grade },
      NOW,
    );
    expect(result.repetitions).toBe(reps);
    expect(result.intervalDays).toBe(interval);
    expect(result.easeFactor).toBeCloseTo(ef, 5);
    expect(daysBetween(NOW, result.nextDueAt)).toBe(interval);
  });
});

describe("computeNextSchedule — ease factor floor", () => {
  it(`never drops the ease factor below ${MIN_EASE_FACTOR}, however many lapses occur`, () => {
    let state: SM2Input = { easeFactor: 1.35, intervalDays: 1, repetitions: 2, grade: 0 };
    for (let i = 0; i < 10; i++) {
      const result = computeNextSchedule(state, NOW);
      expect(result.easeFactor).toBeGreaterThanOrEqual(MIN_EASE_FACTOR);
      state = { ...result, grade: 0 };
    }
  });

  it("clamps a single very-low-quality review that would otherwise go below the floor", () => {
    const result = computeNextSchedule(
      { easeFactor: 1.3, intervalDays: 1, repetitions: 3, grade: 0 },
      NOW,
    );
    expect(result.easeFactor).toBe(MIN_EASE_FACTOR);
  });
});

describe("computeNextSchedule — interval progression on repeated success", () => {
  it("grows 1 -> 6 -> round(interval * EF) on consecutive grade-5 reviews", () => {
    let state: SM2Input = { ...freshCard };
    let now = NOW;

    const r1 = computeNextSchedule(state, now);
    expect(r1.intervalDays).toBe(1);
    expect(r1.easeFactor).toBeCloseTo(2.6, 5);

    state = { ...r1, grade: 5 };
    now = r1.nextDueAt;
    const r2 = computeNextSchedule(state, now);
    expect(r2.intervalDays).toBe(6);
    expect(r2.easeFactor).toBeCloseTo(2.7, 5);

    state = { ...r2, grade: 5 };
    now = r2.nextDueAt;
    const r3 = computeNextSchedule(state, now);
    // round(6 * 2.7) = round(16.2) = 16
    expect(r3.intervalDays).toBe(16);
    expect(r3.easeFactor).toBeCloseTo(2.8, 5);

    state = { ...r3, grade: 5 };
    now = r3.nextDueAt;
    const r4 = computeNextSchedule(state, now);
    // round(16 * 2.8) = round(44.8) = 45
    expect(r4.intervalDays).toBe(45);
    expect(r4.easeFactor).toBeCloseTo(2.9, 5);
  });
});

describe("computeNextSchedule — a lapse after a long streak", () => {
  it("resets repetitions to 0 and interval to 1, but does not reset the ease factor", () => {
    // Simulate arriving at a well-established card: many successful reviews behind it.
    const established: SM2Input = { easeFactor: 2.9, intervalDays: 45, repetitions: 4, grade: 2 };
    const result = computeNextSchedule(established, NOW);

    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    // EF still moves by the formula (grade 2 lowers it), it's just not reset to 2.5.
    expect(result.easeFactor).toBeLessThan(2.9);
    expect(result.easeFactor).toBeGreaterThan(MIN_EASE_FACTOR);
  });

  it("a borderline grade 3 still counts as success (repetitions increment, no reset)", () => {
    const established: SM2Input = { easeFactor: 2.5, intervalDays: 6, repetitions: 1, grade: 3 };
    const result = computeNextSchedule(established, NOW);
    expect(result.repetitions).toBe(2);
    expect(result.intervalDays).toBe(6); // repetitions was 1 -> fixed interval of 6
  });
});

describe("computeNextSchedule — nextDueAt", () => {
  it("is exactly `now` plus the new interval in days", () => {
    const result = computeNextSchedule(freshCard, NOW);
    expect(result.nextDueAt.getTime()).toBe(
      NOW.getTime() + result.intervalDays * 24 * 60 * 60 * 1000,
    );
  });
});

describe("computeNextSchedule — determinism", () => {
  it("the same input and `now` always produce the exact same output", () => {
    const a = computeNextSchedule(freshCard, NOW);
    const b = computeNextSchedule(freshCard, NOW);
    expect(a).toEqual(b);
  });
});
