/**
 * Pure time-zone helpers -- no Next/Prisma imports, `now` always passed in. "Today"
 * has to mean the *user's* calendar day, not the server's UTC day: a student at
 * UTC-7 who studies at 8pm is on a different UTC date than one at 8am, which used to
 * break streaks and hide cards due "later today". Uses only Intl, so it works the
 * same on Node and Vercel with no tz database dependency.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** True if `tz` is an IANA zone name Intl understands (e.g. "America/Los_Angeles"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) that `date` falls on in `timeZone`. */
export function localDayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The calendar day before `dayKey`. Pure calendar arithmetic (via noon UTC), so
 * DST transitions -- 23- or 25-hour local days -- can't skip or repeat a day. */
export function previousDayKey(dayKey: string): string {
  const noonUtc = new Date(`${dayKey}T12:00:00.000Z`);
  return new Date(noonUtc.getTime() - DAY_MS).toISOString().slice(0, 10);
}

/** How far `timeZone`'s wall clock is ahead of UTC at instant `date`, in ms. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant the user's *next* local day begins (local midnight tonight). Cards
 * with dueAt before this are "due today". */
export function startOfNextLocalDay(now: Date, timeZone: string): Date {
  const [y, m, d] = localDayKey(now, timeZone).split("-").map(Number);
  const midnightWallClock = Date.UTC(y, m - 1, d + 1); // Date.UTC normalizes month/year rollover
  // Local midnight = wall-clock midnight minus the zone's offset *at that moment*.
  // Guess with the current offset, then correct once in case a DST change falls
  // between now and midnight.
  let guess = midnightWallClock - offsetMs(now, timeZone);
  guess = midnightWallClock - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}
