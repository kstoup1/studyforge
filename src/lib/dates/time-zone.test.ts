import { describe, expect, it } from "vitest";
import { isValidTimeZone, localDayKey, previousDayKey, startOfNextLocalDay } from "./time-zone";

const LA = "America/Los_Angeles";

describe("isValidTimeZone", () => {
  it("accepts IANA zone names and rejects junk", () => {
    expect(isValidTimeZone(LA)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("localDayKey", () => {
  it("uses the user's calendar day, not UTC's", () => {
    // 8pm Sept 23 in LA (PDT, UTC-7) is already Sept 24 in UTC.
    const eveningInLA = new Date("2026-09-24T03:00:00.000Z");
    expect(localDayKey(eveningInLA, "UTC")).toBe("2026-09-24");
    expect(localDayKey(eveningInLA, LA)).toBe("2026-09-23");
  });
});

describe("previousDayKey", () => {
  it("handles month and year boundaries", () => {
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29"); // leap year
  });

  it("steps exactly one calendar day across DST changes", () => {
    expect(previousDayKey("2026-03-09")).toBe("2026-03-08"); // US spring forward is Mar 8
    expect(previousDayKey("2026-11-02")).toBe("2026-11-01"); // US fall back is Nov 1
  });
});

describe("startOfNextLocalDay", () => {
  it("is local midnight tonight, expressed in UTC", () => {
    // 9am PDT on Sept 23 -> next local midnight is Sept 24 00:00 PDT = 07:00 UTC.
    const now = new Date("2026-09-23T16:00:00.000Z");
    expect(startOfNextLocalDay(now, LA).toISOString()).toBe("2026-09-24T07:00:00.000Z");
    expect(startOfNextLocalDay(now, "UTC").toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("uses the new offset when DST ends before midnight", () => {
    // Nov 1 2026, 9am PST (fall back happened at 2am) -> midnight Nov 2 PST = 08:00 UTC.
    const now = new Date("2026-11-01T17:00:00.000Z");
    expect(startOfNextLocalDay(now, LA).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("handles the evening before a DST change", () => {
    // Mar 7 2026, 8pm PST -> midnight Mar 8 is still PST (change is at 2am) = 08:00 UTC.
    const now = new Date("2026-03-08T04:00:00.000Z");
    expect(startOfNextLocalDay(now, LA).toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("works for zones ahead of UTC", () => {
    // 11pm Sept 23 UTC is 8am Sept 24 in Tokyo -> midnight Sept 25 JST = 15:00 UTC Sept 24.
    const now = new Date("2026-09-23T23:00:00.000Z");
    expect(startOfNextLocalDay(now, "Asia/Tokyo").toISOString()).toBe("2026-09-24T15:00:00.000Z");
  });
});
