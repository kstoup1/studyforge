import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cardsToAnkiTsv, cardsToCsv } from "@/lib/export/card-export";

export async function GET(req: Request, context: { params: Promise<{ deckId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { deckId } = await context.params;
  // Ownership check happens in the query itself -- same pattern as
  // src/actions/decks.ts and src/app/api/uploads/route.ts.
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: session.user.id },
    include: { cards: { select: { question: true, answer: true } } },
  });
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const format = new URL(req.url).searchParams.get("format") === "anki" ? "anki" : "csv";
  const safeName = deck.title.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "deck";

  if (format === "anki") {
    return new NextResponse(cardsToAnkiTsv(deck.cards), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}-anki.txt"`,
      },
    });
  }

  return new NextResponse(cardsToCsv(deck.cards), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
}
