"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const deckInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
});

export async function listDecks() {
  const userId = await requireUserId();
  return prisma.deck.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { cards: true } } },
  });
}

export async function getDeck(deckId: string) {
  const userId = await requireUserId();
  // Scoped by userId in the query itself (not fetched-then-checked) so a deck id
  // guessed from another account's URL never even reaches a truthy result.
  return prisma.deck.findFirst({
    where: { id: deckId, userId },
    include: { cards: true, noteSets: true },
  });
}

export async function createDeck(input: unknown) {
  const userId = await requireUserId();
  const { title, description } = deckInputSchema.parse(input);
  const deck = await prisma.deck.create({ data: { userId, title, description } });
  revalidatePath("/decks");
  return deck;
}

export async function renameDeck(deckId: string, input: unknown) {
  const userId = await requireUserId();
  const { title, description } = deckInputSchema.parse(input);
  // updateMany + a {id, userId} where clause is one atomic ownership-checked write --
  // no separate "does this deck belong to this user" read followed by a write that
  // could race with a delete, and no risk of updating someone else's row.
  const result = await prisma.deck.updateMany({
    where: { id: deckId, userId },
    data: { title, description },
  });
  if (result.count === 0) throw new Error("Deck not found");
  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
}

export async function deleteDeck(deckId: string) {
  const userId = await requireUserId();
  const result = await prisma.deck.deleteMany({ where: { id: deckId, userId } });
  if (result.count === 0) throw new Error("Deck not found");
  revalidatePath("/decks");
}
