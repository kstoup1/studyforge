import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { chunkText, mergeAndCap } from "./chunking";
import type { FlashcardGenerator, GenerateFlashcardsInput, GeneratedCard } from "./types";

// Re-exported: the chunking tests have always imported these from here.
export { chunkText, mergeAndCap };

// claude-sonnet-5: good balance of quality/cost for structured extraction like this;
// no need for the largest model (Opus) just to turn notes into flashcards.
const MODEL = "claude-sonnet-5";
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
