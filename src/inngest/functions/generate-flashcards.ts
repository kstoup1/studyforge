import { z } from "zod";
import { inngest, NOTES_UPLOADED_EVENT } from "@/inngest/client";
import { prisma } from "@/lib/db";
import { getFlashcardGenerator } from "@/lib/llm";

const eventDataSchema = z.object({ generationJobId: z.string().min(1) });

/**
 * The async note -> flashcards pipeline (see docs/PLAN.md §1 for the full
 * rationale): extract -> generate -> persist, as independently-retried steps, so a
 * transient failure in one step doesn't re-run the others. Triggered by the
 * NOTES_UPLOADED_EVENT sent from the upload Server Action/Route Handler; the client
 * polls GET /api/jobs/:id (reading GenerationJob.status/stage) for progress instead
 * of needing a websocket.
 */
export const generateFlashcards = inngest.createFunction(
  { id: "generate-flashcards", retries: 2, triggers: [{ event: NOTES_UPLOADED_EVENT }] },
  async ({ event, step }) => {
    const { generationJobId } = eventDataSchema.parse(event.data);

    const noteSet = await step.run("load-note-set", async () => {
      const job = await prisma.generationJob.findUniqueOrThrow({
        where: { id: generationJobId },
        include: { noteSet: { include: { deck: true } } },
      });
      return {
        deckId: job.noteSet.deckId,
        noteSetId: job.noteSet.id,
        text: job.noteSet.extractedText,
        userId: job.noteSet.deck.userId,
      };
    });

    await step.run("mark-processing", async () => {
      await prisma.generationJob.update({
        where: { id: generationJobId },
        data: { status: "PROCESSING", stage: "generating" },
      });
    });

    try {
      const cards = await step.run("generate-cards", async () => {
        const generator = getFlashcardGenerator();
        return generator.generateFlashcards({ text: noteSet.text });
      });

      await step.run("persist-cards", async () => {
        // A callback transaction (not the array form) because CardScheduleState rows
        // need the ids createManyAndReturn just handed back -- every card gets one at
        // creation time so downstream "due cards" queries never have to null-check or
        // lazily create scheduling state.
        await prisma.$transaction(async (tx) => {
          const created = await tx.card.createManyAndReturn({
            data: cards.map((card) => ({
              deckId: noteSet.deckId,
              noteSetId: noteSet.noteSetId,
              question: card.question,
              answer: card.answer,
            })),
          });
          await tx.cardScheduleState.createMany({
            data: created.map((card) => ({ cardId: card.id, userId: noteSet.userId })),
          });
          await tx.generationJob.update({
            where: { id: generationJobId },
            data: { status: "COMPLETED", stage: null, cardsCreated: cards.length },
          });
        });
      });

      return { cardsCreated: cards.length };
    } catch (err) {
      // Not wrapped in step.run: this must run even after the function's own step
      // retries are exhausted, so the job is never left stuck in PROCESSING forever.
      await prisma.generationJob.update({
        where: { id: generationJobId },
        data: {
          status: "FAILED",
          stage: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // still surface it to Inngest's own dashboard/retry accounting
    }
  },
);
