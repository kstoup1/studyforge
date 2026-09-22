import { describe, expect, it } from "vitest";
import { computeStreak, computeMasteryPercent, isMastered } from "./stats";

const NOW = new Date("2026-01-10T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("computeStreak", () => {
  it("is 0 with no reviews at all", () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it("is 0 if the last review was 2+ days ago", () => {
    expect(computeStreak([daysAgo(2)], NOW)).toBe(0);
  });

  it("is 1 with a single review today", () => {
    expect(computeStreak([daysAgo(0)], NOW)).toBe(1);
  });

  it("counts multiple reviews on the same day as one day of streak", () => {
    expect(computeStreak([daysAgo(0), daysAgo(0), daysAgo(0)], NOW)).toBe(1);
  });

  it("counts consecutive days correctly", () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)], NOW)).toBe(3);
  });

  it("stops at the first gap", () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(3)], NOW)).toBe(2);
  });

  it("still counts an ongoing streak if today has no review yet but yesterday does", () => {
    expect(computeStreak([daysAgo(1), daysAgo(2)], NOW)).toBe(2);
  });

  it("is unaffected by review order in the input array", () => {
    expect(computeStreak([daysAgo(2), daysAgo(0), daysAgo(1)], NOW)).toBe(3);
  });
});

describe("isMastered", () => {
  it("is true once repetitions reach 2", () => {
    expect(isMastered({ repetitions: 2, intervalDays: 1 })).toBe(true);
    expect(isMastered({ repetitions: 1, intervalDays: 1 })).toBe(false);
  });

  it("is true once the interval reaches 21 days, even with low repetitions", () => {
    expect(isMastered({ repetitions: 0, intervalDays: 21 })).toBe(true);
    expect(isMastered({ repetitions: 0, intervalDays: 20 })).toBe(false);
  });
});

describe("computeMasteryPercent", () => {
  it("is 0 for an empty deck", () => {
    expect(computeMasteryPercent([])).toBe(0);
  });

  it("computes the rounded percentage of mastered cards", () => {
    const cards = [
      { repetitions: 3, intervalDays: 10 }, // mastered
      { repetitions: 0, intervalDays: 1 }, // not
      { repetitions: 0, intervalDays: 1 }, // not
    ];
    expect(computeMasteryPercent(cards)).toBe(33); // round(1/3 * 100)
  });

  it("is 100 when every card is mastered", () => {
    const cards = [
      { repetitions: 5, intervalDays: 30 },
      { repetitions: 2, intervalDays: 6 },
    ];
    expect(computeMasteryPercent(cards)).toBe(100);
  });
});
