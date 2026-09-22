"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

/** Cards in a deck that are due for review right now (scheduling.dueAt <= now),
 * soonest-due first. Ownership is enforced via the deck lookup itself (a card in
 * someone else's deck never matches), not a separate check. */
export async function getDueCards(deckId: string) {
  const userId = await requireUserId();
  return prisma.card.findMany({
    where: {
      deckId,
      deck: { userId },
      scheduling: { dueAt: { lte: new Date() } },
    },
    include: { scheduling: true },
    orderBy: { scheduling: { dueAt: "asc" } },
  });
}
