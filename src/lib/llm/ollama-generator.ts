import { z } from "zod";
import { chunkText, mergeAndCap } from "./chunking";
import type { FlashcardGenerator, GenerateFlashcardsInput, GeneratedCard } from "./types";

/**
 * Flashcard generation with a local model via Ollama (https://ollama.com) -- free, no
 * API key, and the notes never leave the machine. Same contract as the Claude
 * generator: chunk, generate per chunk, dedupe, cap.
 *
 * Structured output comes from Ollama's `format` option with a JSON schema, which
 * constrains decoding to valid JSON of that shape -- far more reliable with an 8B
 * model than asking nicely in the prompt. Results are still zod-validated, and one
 * malformed chunk is retried once, since local sampling is less consistent than
 * Claude's forced tool use.
 */

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.1";
// Smaller than Claude's 12k: an 8B model writes better cards from less text at a
// time, and each chunk stays well inside the context window set below.
const CHUNK_CHARS = 6_000;
const CONTEXT_TOKENS = 8_192; // Ollama defaults to a much smaller window
const DEFAULT_MAX_CARDS = 40;
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000; // local GPU; first call also loads the model

const cardsSchema = z
  .array(z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) }))
  .min(1)
  .max(50);

const RESPONSE_FORMAT = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
      },
    },
  },
  required: ["cards"],
};

const SYSTEM_PROMPT = `You turn a student's lecture notes into concise, exam-relevant flashcards.

Rules:
- Each flashcard is a clear question and a direct, accurate answer, both grounded ONLY in the provided text.
- Prefer conceptual "why"/"how" questions over questions that just restate a definition verbatim.
- No duplicate or near-duplicate questions.
- Keep answers concise: a sentence or two.
- Write between 3 and 10 flashcards, depending on how much substance the text has.
- Respond with JSON: {"cards": [{"question": "...", "answer": "..."}]}`;

/** Our own messages -- deliberately phrased so describeGenerationError passes them
 * through to the student unchanged. */
export class OllamaError extends Error {}

export class OllamaFlashcardGenerator implements FlashcardGenerator {
  constructor(
    private baseUrl = process.env.OLLAMA_URL || DEFAULT_URL,
    private model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async generateFlashcards({ text, maxCards }: GenerateFlashcardsInput): Promise<GeneratedCard[]> {
    const cap = maxCards ?? DEFAULT_MAX_CARDS;
    const results: GeneratedCard[][] = [];
    for (const chunk of chunkText(text, CHUNK_CHARS)) {
      results.push(await this.generateForChunkWithRetry(chunk));
      if (mergeAndCap(results, cap).length >= cap) break;
    }
    return mergeAndCap(results, cap);
  }

  private async generateForChunkWithRetry(chunk: string): Promise<GeneratedCard[]> {
    try {
      return await this.generateForChunk(chunk);
    } catch (err) {
      // Connection/model problems won't fix themselves; a bad sample might.
      if (err instanceof OllamaError) throw err;
      return this.generateForChunk(chunk);
    }
  }

  private async generateForChunk(chunk: string): Promise<GeneratedCard[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: RESPONSE_FORMAT,
          options: { temperature: 0.2, num_ctx: CONTEXT_TOKENS },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: chunk },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new OllamaError("Ollama took too long to respond. Try a shorter document.");
      }
      throw new OllamaError(`Ollama isn't running at ${this.baseUrl}. Start Ollama and try again.`);
    }

    if (res.status === 404) {
      throw new OllamaError(
        `Ollama doesn't have the model "${this.model}". Run: ollama pull ${this.model}`,
      );
    }
    if (!res.ok) {
      throw new OllamaError(`Ollama returned an error (${res.status}). Try again.`);
    }

    const body = (await res.json()) as { message?: { content?: string } };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body.message?.content ?? "");
    } catch {
      throw new Error("Invalid flashcards from model: response was not JSON");
    }
    const parsed = cardsSchema.safeParse((parsedJson as { cards?: unknown })?.cards);
    if (!parsed.success) {
      throw new Error(`Invalid flashcards from model: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
