import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { noteSet: { include: { deck: true } } },
  });

  // Ownership check: a job's note set's deck must belong to the caller. Checked
  // after the fetch (unlike the compound-where pattern elsewhere) because the
  // ownership chain runs through two relations -- still returns 404, not 403, for
  // someone else's job id, so it doesn't leak whether the id exists at all.
  if (!job || job.noteSet.deck.userId !== session.user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    stage: job.stage,
    errorMessage: job.errorMessage,
    cardsCreated: job.cardsCreated,
    deckId: job.noteSet.deckId,
  });
}
