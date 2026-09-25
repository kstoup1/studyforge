"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CanvasClient,
  CanvasError,
  MAX_ITEMS_PER_IMPORT,
  normalizeCanvasUrl,
  type CanvasCourse,
  type CanvasMaterial,
} from "@/lib/canvas/client";
import { decryptToken, encryptToken, TokenDecryptionError } from "@/lib/canvas/token-crypto";
import { enqueueGeneration, EnqueueError } from "@/lib/generation/enqueue";
import { extractPdfText, PdfExtractionError } from "@/lib/pdf/extract-text";

// Like the deck actions, these return { ok, error } instead of throwing: Next.js
// strips thrown Server Action messages in production, and every Canvas failure
// (bad token, hidden course, huge file) needs to reach the student as a readable reason.
type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

/** Only for the local fake Canvas in e2e tests; never honoured in production. */
function allowInsecureCanvasUrls(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.CANVAS_ALLOW_INSECURE_URLS === "1";
}

function describe(err: unknown): string {
  if (
    err instanceof CanvasError ||
    err instanceof PdfExtractionError ||
    err instanceof EnqueueError
  ) {
    return err.message;
  }
  console.error("Unexpected Canvas error", err);
  return "Something went wrong talking to Canvas. Please try again.";
}

async function clientFor(userId: string): Promise<CanvasClient | string> {
  const connection = await prisma.canvasConnection.findUnique({ where: { userId } });
  if (!connection) return "Connect your Canvas account first.";
  try {
    return new CanvasClient(connection.baseUrl, decryptToken(connection.encryptedToken));
  } catch (err) {
    if (err instanceof TokenDecryptionError)
      return "Your Canvas connection needs to be set up again.";
    throw err;
  }
}

export async function getCanvasStatus(): Promise<{
  connected: boolean;
  baseUrl: string | null;
  canvasUserName: string | null;
}> {
  const userId = await requireUserId();
  const connection = await prisma.canvasConnection.findUnique({
    where: { userId },
    select: { baseUrl: true, canvasUserName: true },
  });
  return {
    connected: Boolean(connection),
    baseUrl: connection?.baseUrl ?? null,
    canvasUserName: connection?.canvasUserName ?? null,
  };
}

const connectSchema = z.object({
  baseUrl: z.string().max(300),
  token: z.string().trim().min(20, "That doesn't look like a Canvas access token").max(500),
});

/** Verifies the token against Canvas *before* saving it, so a typo'd token or
 * address fails here with a clear message instead of later during an import. */
export async function connectCanvas(input: unknown): Promise<Result<{ canvasUserName: string }>> {
  const userId = await requireUserId();
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const baseUrl = normalizeCanvasUrl(parsed.data.baseUrl, allowInsecureCanvasUrls());
    const self = await new CanvasClient(baseUrl, parsed.data.token).getSelf();
    const data = {
      baseUrl,
      encryptedToken: encryptToken(parsed.data.token),
      canvasUserName: self.name,
    };
    await prisma.canvasConnection.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    revalidatePath("/settings/canvas");
    return { ok: true, data: { canvasUserName: self.name } };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function disconnectCanvas(): Promise<Result> {
  const userId = await requireUserId();
  await prisma.canvasConnection.deleteMany({ where: { userId } });
  revalidatePath("/settings/canvas");
  return { ok: true, data: undefined };
}

export async function listCanvasCourses(): Promise<Result<CanvasCourse[]>> {
  const userId = await requireUserId();
  const client = await clientFor(userId);
  if (typeof client === "string") return { ok: false, error: client };
  try {
    return { ok: true, data: await client.listCourses() };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function listCanvasMaterials(courseId: number): Promise<Result<CanvasMaterial[]>> {
  const userId = await requireUserId();
  if (!Number.isInteger(courseId) || courseId <= 0) return { ok: false, error: "Invalid course" };
  const client = await clientFor(userId);
  if (typeof client === "string") return { ok: false, error: client };
  try {
    return { ok: true, data: await client.listCourseMaterials(courseId) };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

const importSchema = z.object({
  deckId: z.string().min(1),
  courseId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        kind: z.enum(["file", "page"]),
        ref: z.string().min(1).max(300),
        title: z.string().max(500),
      }),
    )
    .min(1, "Pick at least one item")
    .max(MAX_ITEMS_PER_IMPORT, `Import at most ${MAX_ITEMS_PER_IMPORT} items at a time`),
});

export type ImportItemResult = { title: string } & (
  { ok: true; jobId: string } | { ok: false; error: string }
);

/**
 * Pulls each selected file/page out of Canvas, extracts its text, and starts the same
 * generation pipeline a PDF upload uses -- one job per item, so one bad file (locked,
 * scanned, too big) doesn't sink the rest. Items are processed one at a time to stay
 * gentle on Canvas's rate limits.
 */
export async function importFromCanvas(input: unknown): Promise<Result<ImportItemResult[]>> {
  const userId = await requireUserId();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { deckId, courseId, items } = parsed.data;

  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } });
  if (!deck) return { ok: false, error: "Deck not found" };
  const client = await clientFor(userId);
  if (typeof client === "string") return { ok: false, error: client };

  const results: ImportItemResult[] = [];
  for (const item of items) {
    let title = item.title;
    try {
      let text: string;
      if (item.kind === "page") {
        const page = await client.getPageText(courseId, item.ref);
        title = page.title || title;
        text = page.text;
      } else {
        const file = await client.downloadFile(courseId, item.ref);
        title = file.filename || title;
        const looksLikePdf = new TextDecoder().decode(file.bytes.subarray(0, 5)) === "%PDF-";
        if (!looksLikePdf) {
          throw new CanvasError(
            `"${title}" isn't a PDF -- only PDFs and Canvas pages are supported.`,
          );
        }
        text = await extractPdfText(file.bytes);
      }
      if (!text.trim()) throw new CanvasError(`"${title}" has no text to make flashcards from.`);

      const { jobId } = await enqueueGeneration({
        deckId,
        sourceType: item.kind === "page" ? "CANVAS_PAGE" : "CANVAS_FILE",
        originalFilename: title,
        extractedText: text,
      });
      results.push({ title, ok: true, jobId });
    } catch (err) {
      results.push({ title, ok: false, error: describe(err) });
      // A revoked token will fail every remaining item the same way; stop early.
      if (err instanceof CanvasError && err.status === 401) break;
    }
  }
  revalidatePath(`/decks/${deckId}`);
  return { ok: true, data: results };
}
