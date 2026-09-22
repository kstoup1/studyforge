"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeStreak, computeMasteryPercent } from "@/lib/dashboard/stats";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

export interface DashboardData {
  dueToday: number;
  streak: number;
  decks: { id: string; title: string; cardCount: number; masteryPercent: number }[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const userId = await requireUserId();

  const [decks, dueToday, reviewLogs] = await Promise.all([
    prisma.deck.findMany({
      where: { userId },
      include: { cards: { include: { scheduling: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cardScheduleState.count({ where: { userId, dueAt: { lte: new Date() } } }),
    prisma.reviewLog.findMany({ where: { userId }, select: { reviewedAt: true } }),
  ]);

  const streak = computeStreak(reviewLogs.map((r) => r.reviewedAt));

  const deckStats = decks.map((deck) => {
    const schedules = deck.cards
      .map((card) => card.scheduling)
      .filter((s): s is NonNullable<typeof s> => s !== null);
    return {
      id: deck.id,
      title: deck.title,
      cardCount: deck.cards.length,
      masteryPercent: computeMasteryPercent(schedules),
    };
  });

  return { dueToday, streak, decks: deckStats };
}
