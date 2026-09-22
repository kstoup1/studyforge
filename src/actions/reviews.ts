"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeNextSchedule } from "@/lib/sm2/sm2";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const submitReviewSchema = z.object({
  cardId: z.string().min(1),
  grade: z.number().int().min(0).max(5),
});

/**
 * Grades one card review and reschedules it. Thin I/O wrapper around the pure
 * computeNextSchedule (src/lib/sm2/sm2.ts) -- all the actual scheduling logic lives
 * there and is unit-tested there; this just loads state, calls it, and writes the
 * result back plus an append-only ReviewLog row, atomically.
 */
export async function submitReview(input: unknown) {
  const userId = await requireUserId();
  const { cardId, grade } = submitReviewSchema.parse(input);

  // Ownership enforced in the query itself: a card whose scheduling.userId doesn't
  // match the caller (or that doesn't exist) simply won't be found.
  const scheduling = await prisma.cardScheduleState.findFirst({
    where: { cardId, userId },
  });
  if (!scheduling) throw new Error("Card not found");

  const result = computeNextSchedule(
    {
      easeFactor: scheduling.easeFactor,
      intervalDays: scheduling.intervalDays,
      repetitions: scheduling.repetitions,
      grade,
    },
    new Date(),
  );

  await prisma.$transaction([
    prisma.cardScheduleState.update({
      where: { cardId },
      data: {
        easeFactor: result.easeFactor,
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        dueAt: result.nextDueAt,
        lastReviewedAt: new Date(),
      },
    }),
    prisma.reviewLog.create({
      data: {
        cardId,
        userId,
        grade,
        easeFactorAfter: result.easeFactor,
        intervalDaysAfter: result.intervalDays,
      },
    }),
  ]);

  // No revalidatePath: the study session UI manages its own queue client-side
  // (advances to the next card locally after each grade) rather than re-fetching
  // from the server mid-session, so there's no stale Server Component cache to bust.
  return { nextDueAt: result.nextDueAt };
}
