"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keep in sync with TIME_ZONE_COOKIE in src/lib/dates/user-time-zone.ts (not imported:
// that module uses next/headers, which can't be bundled into a client component).
const COOKIE = "tz";

/** Tells the server the browser's time zone so "today" (streaks, due cards) means the
 * user's calendar day. Re-renders once if the zone was missing or changed (first
 * visit, or travelling) so the page the user is looking at is immediately correct. */
export function TimeZoneCookie() {
  const router = useRouter();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (current && decodeURIComponent(current) === tz) return;
    document.cookie = `${COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
