import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { FlashcardGenerator, GenerateFlashcardsInput, GeneratedCard } from "./types";

// claude-sonnet-5: good balance of quality/cost for structured extraction like this;
// no need for the largest model (Opus) just to turn notes into flashcards.
const MODEL = "claude-sonnet-5";
const MAX_CHUNK_CHARS = 12_000;
const DEFAULT_MAX_CARDS = 40;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

const cardSchema = z.object({
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});
const cardsSchema = z.array(cardSchema).min(1).max(50);

/** Thrown when the model's output fails schema validation. Never retried -- a
 * malformed response won't fix itself by asking again with the same input. */
export class FlashcardValidationError extends Error {}

const SYSTEM_PROMPT = `You turn a student's lecture notes into concise, exam-relevant flashcards.

Rules:
- Each flashcard is a clear question and a direct, accurate answer, both grounded in the provided text.
- Prefer conceptual "why"/"how" questions over questions that just restate a definition verbatim.
- No duplicate or near-duplicate questions.
- Keep answers concise -- a sentence or two, not a paragraph.
- You MUST respond by calling the record_flashcards tool. Do not respond with plain text.`;

/**
 * Splits text into chunks no larger than maxChars, preferring the most natural break
 * available: paragraphs (blank lines), then single line breaks, then sentence ends,
 * and only as a last resort a hard cut. The finer levels matter for PDFs: unpdf's
 * mergePages output usually has no blank lines at all, so paragraph-only splitting
 * used to send an entire PDF to the model as one oversized chunk.
 * Pure function, no I/O -- independently unit-tested.
 */
export function chunkText(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  return packPieces(splitToFit(trimmed, maxChars, 0), maxChars);
}

// Coarsest to finest. Each keeps its delimiter when rejoined by packPieces.
const SPLITTERS: { pattern: RegExp; joiner: string }[] = [
  { pattern: /\n\s*\n/, joiner: "\n\n" },
  { pattern: /\n/, joiner: "\n" },
  { pattern: /(?<=[.!?])\s+/, joiner: " " },
];

interface Piece {
  text: string;
  joiner: string; // what goes between this piece and the previous one
}

/** Breaks text into pieces that each fit in maxChars, using the coarsest splitter
 * that works and recursing to finer ones only for pieces that are still too big. */
function splitToFit(text: string, maxChars: number, level: number): Piece[] {
  if (text.length <= maxChars) return [{ text, joiner: "\n\n" }];
  if (level >= SPLITTERS.length) {
    const pieces: Piece[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push({ text: text.slice(i, i + maxChars), joiner: "" });
    }
    return pieces;
  }
  const { pattern, joiner } = SPLITTERS[level];
  const parts = text.split(pattern).filter((p) => p.trim().length > 0);
  if (parts.length === 1) return splitToFit(text, maxChars, level + 1);
  return parts.flatMap((part, i) =>
    splitToFit(part, maxChars, level + 1).map((piece, j) =>
      // The first sub-piece of each part is joined with this level's delimiter; the
      // rest keep the finer delimiter they were split on.
      j === 0 && i > 0 ? { ...piece, joiner } : piece,
    ),
  );
}

/** Greedily packs consecutive pieces into chunks of at most maxChars. */
function packPieces(pieces: Piece[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}${piece.joiner}${piece.text}` : piece.text;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = piece.text;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Merges chunk results, drops exact-duplicate questions (case/whitespace-insensitive,
 * common when the same concept appears in adjacent chunks), and caps the total. */
export function mergeAndCap(chunkResults: GeneratedCard[][], maxCards: number): GeneratedCard[] {
  const seen = new Set<string>();
  const merged: GeneratedCard[] = [];
  for (const cards of chunkResults) {
    for (const card of cards) {
      const key = card.question.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(card);
      if (merged.length >= maxCards) return merged;
    }
  }
  return merged;
}

/** True for errors retrying again with the same input can't possibly fix: bad
 * request, auth, permissions -- anything but a 429 (rate limit, transient) or a
 * network/5xx failure (also transient). Found live: a 401 (invalid API key) was
 * being retried 3 times internally on top of Inngest's own step-level retries,
 * turning one permanent failure into up to 9 real API calls and a much longer
 * wait than the job actually needed before correctly failing anyway. */
export function isPermanentError(err: unknown): boolean {
  if (err instanceof FlashcardValidationError) return true;
  if (err instanceof Anthropic.APIError && err.status !== undefined && err.status !== 429) {
    return err.status >= 400 && err.status < 500;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isPermanentError(err)) throw err;
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
        );
      }
    }
  }
  throw lastError;
}

export class ClaudeFlashcardGenerator implements FlashcardGenerator {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateFlashcards({ text, maxCards }: GenerateFlashcardsInput): Promise<GeneratedCard[]> {
    const cap = maxCards ?? DEFAULT_MAX_CARDS;
    const chunks = chunkText(text);
    const results: GeneratedCard[][] = [];
    for (const chunk of chunks) {
      results.push(await withRetry(() => this.generateForChunk(chunk)));
      if (mergeAndCap(results, cap).length >= cap) break; // stop early once we have enough
    }
    return mergeAndCap(results, cap);
  }

  private async generateForChunk(text: string): Promise<GeneratedCard[]> {
    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
      tools: [
        {
          name: "record_flashcards",
          description: "Records the generated flashcards.",
          input_schema: {
            type: "object",
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string" },
                    answer: { type: "string" },
                  },
                  required: ["question", "answer"],
                },
              },
            },
            required: ["cards"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_flashcards" },
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new FlashcardValidationError("Model did not call record_flashcards");
    }

    const input = toolUse.input as { cards?: unknown };
    const parsed = cardsSchema.safeParse(input.cards);
    if (!parsed.success) {
      throw new FlashcardValidationError(`Invalid flashcards from model: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
