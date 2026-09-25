import { describe, expect, it, vi, beforeEach } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import { chunkText, mergeAndCap } from "./claude-generator";
import type { GeneratedCard } from "./types";

// The Anthropic SDK's *client* is never called for real in tests -- this mock stands
// in for it. createMock is reassigned per-test so each test controls exactly what
// the "model" returns, without ever making a real API call (per the plan: never hit
// a real LLM API in CI). The real APIError class is kept on the mock's static side
// (claude-generator.ts checks `err instanceof Anthropic.APIError`), so tests can
// construct real, correctly-shaped error instances instead of approximating them.
const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  return {
    ...actual,
    default: class MockAnthropic {
      static APIError = actual.APIError;
      messages = { create: (...args: unknown[]) => createMock(...args) };
    },
  };
});

// Imported after the mock is set up so claude-generator.ts picks up the mocked SDK.
const { ClaudeFlashcardGenerator, FlashcardValidationError, isPermanentError } =
  await import("./claude-generator");

function toolUseResponse(cards: GeneratedCard[]) {
  return { content: [{ type: "tool_use", name: "record_flashcards", input: { cards } }] };
}

describe("chunkText", () => {
  it("returns an empty array for empty/whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk when text is under the limit", () => {
    expect(chunkText("short text", 100)).toEqual(["short text"]);
  });

  it("splits on paragraph boundaries when text exceeds the limit", () => {
    const a = "A".repeat(50);
    const b = "B".repeat(50);
    const c = "C".repeat(50);
    const text = `${a}\n\n${b}\n\n${c}`;
    const chunks = chunkText(text, 110); // fits ~2 paragraphs (50 + 2 + 50 = 102) per chunk
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(`${a}\n\n${b}`);
    expect(chunks[1]).toBe(c);
  });

  it("never returns a chunk longer than maxChars, even with no break points", () => {
    const huge = "X".repeat(250);
    const chunks = chunkText(huge, 100);
    expect(chunks).toEqual(["X".repeat(100), "X".repeat(100), "X".repeat(50)]);
  });

  it("splits PDF-style text (single newlines, no blank lines) on line breaks", () => {
    // unpdf's mergePages output: one line per text run, no paragraph gaps. This used
    // to come back as a single chunk the size of the whole PDF.
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i} of the lecture notes.`);
    const chunks = chunkText(lines.join("\n"), 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join("\n")).toBe(lines.join("\n")); // nothing lost or reordered
  });

  it("falls back to sentence boundaries for one long line", () => {
    const sentence = "Mitochondria produce ATP through cellular respiration.";
    const text = Array.from({ length: 10 }, () => sentence).join(" ");
    const chunks = chunkText(text, 120);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      expect(chunk.endsWith(".")).toBe(true); // never cut mid-sentence
    }
    expect(chunks.join(" ")).toBe(text);
  });

  it("keeps paragraph breaks between paragraphs that land in the same chunk", () => {
    const a = "A".repeat(150);
    const b = "B".repeat(20);
    const c = "C".repeat(20);
    // `a` alone is too big and gets hard-split; b and c still pack with "\n\n".
    const chunks = chunkText(`${a}\n\n${b}\n\n${c}`, 100);
    expect(chunks[chunks.length - 1]).toBe(`${"A".repeat(50)}\n\n${b}\n\n${c}`);
  });
});

describe("mergeAndCap", () => {
  it("concatenates chunk results in order", () => {
    const a: GeneratedCard = { question: "Q1", answer: "A1" };
    const b: GeneratedCard = { question: "Q2", answer: "A2" };
    expect(mergeAndCap([[a], [b]], 10)).toEqual([a, b]);
  });

  it("drops case/whitespace-insensitive duplicate questions", () => {
    const a: GeneratedCard = { question: "What is mitosis?", answer: "A1" };
    const dupe: GeneratedCard = {
      question: "  what IS mitosis?  ",
      answer: "A2 (should be dropped)",
    };
    expect(mergeAndCap([[a], [dupe]], 10)).toEqual([a]);
  });

  it("caps the total at maxCards", () => {
    const cards: GeneratedCard[] = Array.from({ length: 5 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));
    expect(mergeAndCap([cards], 3)).toHaveLength(3);
  });
});

describe("isPermanentError", () => {
  it("treats FlashcardValidationError as permanent", () => {
    expect(isPermanentError(new FlashcardValidationError("bad"))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("treats a %i APIError as permanent", (status) => {
    const err = new APIError(status, { error: { message: "x" } }, "x", undefined);
    expect(isPermanentError(err)).toBe(true);
  });

  it("does NOT treat a 429 APIError as permanent (rate limits are transient)", () => {
    const err = new APIError(429, { error: { message: "x" } }, "x", undefined);
    expect(isPermanentError(err)).toBe(false);
  });

  it.each([500, 502, 503, 529])(
    "does NOT treat a %i APIError as permanent (server errors are transient)",
    (status) => {
      const err = new APIError(status, { error: { message: "x" } }, "x", undefined);
      expect(isPermanentError(err)).toBe(false);
    },
  );

  it("does NOT treat a plain Error (e.g. network failure, no status) as permanent", () => {
    expect(isPermanentError(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("ClaudeFlashcardGenerator", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns validated cards from a single-chunk generation", async () => {
    const cards = [{ question: "Q", answer: "A" }];
    createMock.mockResolvedValueOnce(toolUseResponse(cards));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    const result = await generator.generateFlashcards({ text: "some short notes" });

    expect(result).toEqual(cards);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("throws FlashcardValidationError and does NOT retry when the model skips the tool call", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "I have thoughts instead" }] });

    const generator = new ClaudeFlashcardGenerator("fake-key");
    await expect(generator.generateFlashcards({ text: "notes" })).rejects.toThrow(
      FlashcardValidationError,
    );
    expect(createMock).toHaveBeenCalledTimes(1); // not 3 -- validation failures aren't retried
  });

  it("throws FlashcardValidationError and does NOT retry on malformed tool input", async () => {
    createMock.mockResolvedValue(toolUseResponse([{ question: "", answer: "A" } as GeneratedCard]));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    await expect(generator.generateFlashcards({ text: "notes" })).rejects.toThrow(
      FlashcardValidationError,
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a permanent 401 (invalid API key) -- found live: this was costing up to 9 real API calls (3 internal retries x Inngest's own 2 function-level retries) before correctly failing anyway", async () => {
    createMock.mockRejectedValue(
      new APIError(
        401,
        { error: { message: "API key is invalid." } },
        "API key is invalid.",
        undefined,
      ),
    );

    const generator = new ClaudeFlashcardGenerator("fake-key");
    await expect(generator.generateFlashcards({ text: "notes" })).rejects.toThrow(
      "API key is invalid",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a permanent 403 (permission denied)", async () => {
    createMock.mockRejectedValue(
      new APIError(403, { error: { message: "forbidden" } }, "forbidden", undefined),
    );

    const generator = new ClaudeFlashcardGenerator("fake-key");
    await expect(generator.generateFlashcards({ text: "notes" })).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("DOES retry a 429 (rate limited) since that's genuinely transient", async () => {
    createMock
      .mockRejectedValueOnce(
        new APIError(429, { error: { message: "rate limited" } }, "rate limited", undefined),
      )
      .mockResolvedValueOnce(toolUseResponse([{ question: "Q", answer: "A" }]));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    const result = await generator.generateFlashcards({ text: "notes" });

    expect(result).toEqual([{ question: "Q", answer: "A" }]);
    expect(createMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it("retries transient errors up to 3 attempts, succeeding on the last one", async () => {
    createMock
      .mockRejectedValueOnce(new Error("529 overloaded"))
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockResolvedValueOnce(toolUseResponse([{ question: "Q", answer: "A" }]));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    const result = await generator.generateFlashcards({ text: "notes" });

    expect(result).toEqual([{ question: "Q", answer: "A" }]);
    expect(createMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it("gives up after exhausting all retry attempts on persistent transient errors", async () => {
    createMock.mockRejectedValue(new Error("529 overloaded"));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    await expect(generator.generateFlashcards({ text: "notes" })).rejects.toThrow("529 overloaded");
    expect(createMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it("chunks long text into multiple calls and merges the results", async () => {
    const paragraph = "X".repeat(8000);
    const longText = `${paragraph}\n\n${paragraph}\n\n${paragraph}`; // 3 chunks at the default 12k limit

    createMock
      .mockResolvedValueOnce(toolUseResponse([{ question: "Q1", answer: "A1" }]))
      .mockResolvedValueOnce(toolUseResponse([{ question: "Q2", answer: "A2" }]))
      .mockResolvedValueOnce(toolUseResponse([{ question: "Q3", answer: "A3" }]));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    const result = await generator.generateFlashcards({ text: longText, maxCards: 40 });

    expect(createMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
      { question: "Q3", answer: "A3" },
    ]);
  });

  it("stops issuing further chunk calls once maxCards is already reached", async () => {
    const paragraph = "X".repeat(8000);
    const longText = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

    const twoCards = Array.from({ length: 2 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    createMock.mockResolvedValue(toolUseResponse(twoCards));

    const generator = new ClaudeFlashcardGenerator("fake-key");
    const result = await generator.generateFlashcards({ text: longText, maxCards: 2 });

    expect(result).toHaveLength(2);
    expect(createMock).toHaveBeenCalledTimes(1); // stopped after the first chunk already hit the cap
  });
});
