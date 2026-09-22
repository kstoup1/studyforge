import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractPdfText, PdfExtractionError } from "@/lib/pdf/extract-text";
import { inngest, NOTES_UPLOADED_EVENT } from "@/inngest/client";

export const runtime = "nodejs"; // PDF parsing needs Node APIs, not the Edge runtime

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB, per docs/PLAN.md §6

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const form = await req.formData();
  const deckId = form.get("deckId");
  if (typeof deckId !== "string" || !deckId) {
    return NextResponse.json({ error: "deckId is required" }, { status: 400 });
  }

  // Ownership check happens in the query itself (not fetch-then-check) -- same
  // pattern as src/actions/decks.ts.
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId: session.user.id } });
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const file = form.get("file");
  const pastedText = form.get("text");

  let extractedText: string;
  let sourceType: "PDF" | "PASTED_TEXT";
  let originalFilename: string | null = null;

  if (file instanceof File) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      extractedText = await extractPdfText(bytes);
    } catch (err) {
      const message = err instanceof PdfExtractionError ? err.message : "Failed to read PDF";
      return NextResponse.json({ error: message }, { status: 422 });
    }
    sourceType = "PDF";
    originalFilename = file.name;
  } else if (typeof pastedText === "string" && pastedText.trim()) {
    extractedText = pastedText.trim();
    sourceType = "PASTED_TEXT";
  } else {
    return NextResponse.json(
      { error: "Provide either a PDF file or pasted text" },
      { status: 400 },
    );
  }

  const noteSet = await prisma.noteSet.create({
    data: { deckId, sourceType, originalFilename, extractedText },
  });
  const job = await prisma.generationJob.create({
    data: { noteSetId: noteSet.id, status: "PENDING" },
  });

  await inngest.send({ name: NOTES_UPLOADED_EVENT, data: { generationJobId: job.id } });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
