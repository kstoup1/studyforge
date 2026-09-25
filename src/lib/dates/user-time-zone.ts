import { cookies } from "next/headers";
import { isValidTimeZone } from "@/lib/dates/time-zone";

/** Cookie the browser writes its IANA zone into (src/components/time-zone-cookie.tsx). */
export const TIME_ZONE_COOKIE = "tz";

/** The signed-in user's time zone, from the browser-reported cookie. Falls back to
 * UTC on a first-ever visit (before the cookie exists) or if the value is junk --
 * the cookie is client-controlled, so it's validated rather than trusted. */
export async function getUserTimeZone(): Promise<string> {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return value && isValidTimeZone(value) ? value : "UTC";
}
