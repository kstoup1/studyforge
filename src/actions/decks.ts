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
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  // Blank means "no description" -- stored as null so clearing it on rename works
  // (it used to be sent as undefined, which Prisma treats as "leave unchanged").
  description: z
    .string()
    .trim()
    .max(2000, "Description is too long")
    .optional()
    .transform((d) => d || null),
});

/** Returned instead of thrown: Next.js strips thrown Server Action error messages in
 * production builds, so validation errors have to come back as data to be shown. */
export type DeckActionResult = { ok: true } | { ok: false; error: string };

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
    include: { cards: { orderBy: { createdAt: "asc" } }, noteSets: true },
  });
}

export async function createDeck(input: unknown): Promise<DeckActionResult> {
  const userId = await requireUserId();
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { title, description } = parsed.data;
  await prisma.deck.create({ data: { userId, title, description } });
  revalidatePath("/decks");
  return { ok: true };
}

export async function renameDeck(deckId: string, input: unknown): Promise<DeckActionResult> {
  const userId = await requireUserId();
  const parsed = deckInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { title, description } = parsed.data;
  // updateMany + a {id, userId} where clause is one atomic ownership-checked write --
  // no separate "does this deck belong to this user" read followed by a write that
  // could race with a delete, and no risk of updating someone else's row.
  const result = await prisma.deck.updateMany({
    where: { id: deckId, userId },
    data: { title, description },
  });
  if (result.count === 0) return { ok: false, error: "Deck not found" };
  revalidatePath("/decks");
  revalidatePath(`/decks/${deckId}`);
  return { ok: true };
}

export async function deleteDeck(deckId: string): Promise<DeckActionResult> {
  const userId = await requireUserId();
  const result = await prisma.deck.deleteMany({ where: { id: deckId, userId } });
  if (result.count === 0) return { ok: false, error: "Deck not found" };
  revalidatePath("/decks");
  return { ok: true };
}
