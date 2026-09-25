// Invoked from e2e specs via child_process, not imported directly -- the generated
// Prisma client (ESM, uses import.meta) can't be loaded through Playwright's default
// CJS test transform, but tsx's native ESM loader handles it fine (the same reason
// the other scripts/*.ts utilities in this repo also run via tsx).
//   npx tsx scripts/e2e/create-cards.ts <deckId> '<json array of {question,answer,dueAt?}>'
// Every card gets a CardScheduleState row, like the real generation pipeline creates
// (src/inngest/functions/generate-flashcards.ts) -- due now unless dueAt is given.
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const [deckId, cardsJson] = process.argv.slice(2);
  if (!deckId || !cardsJson) throw new Error("usage: create-cards.ts <deckId> <cardsJson>");
  const cards: { question: string; answer: string; dueAt?: string }[] = JSON.parse(cardsJson);

  const deck = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } });
  for (const { question, answer, dueAt } of cards) {
    // One at a time (not createMany) so createdAt order matches input order.
    await prisma.card.create({
      data: {
        deckId,
        question,
        answer,
        scheduling: {
          create: { userId: deck.userId, dueAt: dueAt ? new Date(dueAt) : new Date() },
        },
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
