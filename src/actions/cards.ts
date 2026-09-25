"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { startOfNextLocalDay } from "@/lib/dates/time-zone";
import { getUserTimeZone } from "@/lib/dates/user-time-zone";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

/** Cards in a deck that are due for review today -- due any time before the user's
 * local midnight, like Anki, so a card scheduled "1 day" after a 6pm review is
 * studyable the next morning rather than only after 6pm. Soonest-due first. Ownership is enforced via the deck lookup itself (a card in
 * someone else's deck never matches), not a separate check. */
export async function getDueCards(deckId: string) {
  const userId = await requireUserId();
  const dueBefore = startOfNextLocalDay(new Date(), await getUserTimeZone());
  return prisma.card.findMany({
    where: {
      deckId,
      deck: { userId },
      scheduling: { dueAt: { lt: dueBefore } },
    },
    include: { scheduling: true },
    orderBy: { scheduling: { dueAt: "asc" } },
  });
}
