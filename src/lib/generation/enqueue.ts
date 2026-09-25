import type { SourceType } from "@/generated/prisma/client";
import { inngest, NOTES_UPLOADED_EVENT } from "@/inngest/client";
import { prisma } from "@/lib/db";

export class EnqueueError extends Error {}

/**
 * Saves extracted notes and starts the background flashcard pipeline
 * (src/inngest/functions/generate-flashcards.ts). Shared by every way notes get in:
 * PDF/paste uploads and Canvas imports. The caller must already have checked the
 * deck belongs to the current user.
 */
export async function enqueueGeneration(input: {
  deckId: string;
  sourceType: SourceType;
  originalFilename: string | null;
  extractedText: string;
}): Promise<{ jobId: string }> {
  const noteSet = await prisma.noteSet.create({ data: input });
  const job = await prisma.generationJob.create({
    data: { noteSetId: noteSet.id, status: "PENDING" },
  });

  try {
    await inngest.send({ name: NOTES_UPLOADED_EVENT, data: { generationJobId: job.id } });
  } catch (err) {
    // If the event never reaches Inngest, nothing will ever pick this job up -- mark
    // it failed now instead of leaving it PENDING forever with the client polling.
    console.error("Failed to enqueue flashcard generation", err);
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: "Couldn't start generation" },
    });
    throw new EnqueueError(
      "Couldn't start flashcard generation right now. Please try again in a minute.",
    );
  }
  return { jobId: job.id };
}
