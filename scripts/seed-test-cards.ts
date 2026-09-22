// Dev utility: seeds a deck with a few cards (some due now, one due tomorrow) for
// test.student@example.com (create it first via the sign-up page if it doesn't
// exist), so the study session / SM-2 flow can be exercised without spending real
// Anthropic API credits or waiting on generation. Not part of the app; run with:
//   npx tsx scripts/seed-test-cards.ts
// Creates a new deck each run (titled "Study Session Test Deck") rather than
// upserting, so re-running is safe but leaves duplicates -- delete old ones from
// the UI if that matters to you.
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "test.student@example.com" },
  });

  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      title: "Study Session Test Deck",
      description: "Seeded for live testing",
    },
  });

  const cardsData = [
    { question: "What is the powerhouse of the cell?", answer: "The mitochondria" },
    {
      question: "What is Newton's first law?",
      answer: "An object in motion stays in motion unless acted on by a force",
    },
    {
      question: "What is photosynthesis?",
      answer: "The process plants use to convert light into chemical energy",
    },
  ];

  const created = await prisma.card.createManyAndReturn({
    data: cardsData.map((c) => ({ deckId: deck.id, question: c.question, answer: c.answer })),
  });

  // First two due now, third due tomorrow (should NOT show up in the study session).
  await prisma.cardScheduleState.createMany({
    data: [
      { cardId: created[0].id, userId: user.id, dueAt: new Date() },
      { cardId: created[1].id, userId: user.id, dueAt: new Date() },
      { cardId: created[2].id, userId: user.id, dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    ],
  });

  console.log(`Created deck ${deck.id} with ${created.length} cards (2 due now, 1 due tomorrow).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
