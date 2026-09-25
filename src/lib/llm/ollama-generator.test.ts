import { describe, expect, it } from "vitest";
import { describeGenerationError } from "./describe-error";
import { resolveLlmProvider } from "./index";
import { OllamaError, OllamaFlashcardGenerator } from "./ollama-generator";

type Body = {
  model: string;
  format: unknown;
  options: { num_ctx: number };
  messages: { content: string }[];
};

function fakeOllama(replies: (string | Response | Error)[]) {
  const bodies: Body[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return Response.json({ message: { role: "assistant", content: next } });
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

const cards = (n: number, prefix = "Q") =>
  JSON.stringify({
    cards: Array.from({ length: n }, (_, i) => ({ question: `${prefix}${i}?`, answer: `A${i}` })),
  });

describe("OllamaFlashcardGenerator", () => {
  it("asks for schema-constrained JSON with a real context window, and parses cards", async () => {
    const { impl, bodies } = fakeOllama([cards(3)]);
    const gen = new OllamaFlashcardGenerator("http://ollama:11434", "llama3.1", impl);
    const result = await gen.generateFlashcards({ text: "Mitochondria make ATP." });
    expect(result).toHaveLength(3);
    expect(bodies[0].model).toBe("llama3.1");
    expect(bodies[0].format).toMatchObject({ required: ["cards"] });
    expect(bodies[0].options.num_ctx).toBeGreaterThanOrEqual(8192);
    expect(bodies[0].messages[1].content).toBe("Mitochondria make ATP.");
  });

  it("chunks long notes and dedupes across chunks", async () => {
    const para = "Sentence about biology. ".repeat(200).trim(); // ~4.8k chars each
    const text = [para, para, para].join("\n\n");
    const { impl, bodies } = fakeOllama([cards(2), cards(2), cards(3, "New")]);
    const result = await new OllamaFlashcardGenerator("http://o", "m", impl).generateFlashcards({
      text,
    });
    expect(bodies.length).toBe(3);
    for (const b of bodies) expect(b.messages[1].content.length).toBeLessThanOrEqual(6000);
    expect(result.map((c) => c.question)).toEqual(["Q0?", "Q1?", "New0?", "New1?", "New2?"]);
  });

  it("retries a malformed sample once, then gives up with a validation error", async () => {
    const ok = fakeOllama(["not json at all", cards(1)]);
    await expect(
      new OllamaFlashcardGenerator("http://o", "m", ok.impl).generateFlashcards({ text: "x" }),
    ).resolves.toHaveLength(1);

    const bad = fakeOllama(['{"cards": []}', '{"nope": 1}']);
    await expect(
      new OllamaFlashcardGenerator("http://o", "m", bad.impl).generateFlashcards({ text: "x" }),
    ).rejects.toThrow(/Invalid flashcards/);
  });

  it("explains a stopped Ollama or a missing model, without retrying", async () => {
    const down = fakeOllama([new TypeError("fetch failed"), cards(1)]);
    await expect(
      new OllamaFlashcardGenerator("http://o:1", "m", down.impl).generateFlashcards({ text: "x" }),
    ).rejects.toThrow(OllamaError);
    expect(down.bodies).toHaveLength(1); // not retried

    const missing = fakeOllama([new Response("model not found", { status: 404 })]);
    const err = await new OllamaFlashcardGenerator("http://o", "phi9", missing.impl)
      .generateFlashcards({ text: "x" })
      .catch((e) => e);
    expect(err.message).toBe('Ollama doesn\'t have the model "phi9". Run: ollama pull phi9');
    // ...and that exact text is what the student sees on the failed job.
    expect(describeGenerationError(new Error(err.message))).toBe(err.message);
  });
});

describe("resolveLlmProvider", () => {
  it("defaults to local Ollama when there's no API key, Claude when there is", () => {
    expect(resolveLlmProvider({})).toBe("ollama");
    expect(resolveLlmProvider({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
  });

  it("lets LLM_PROVIDER override, and rejects typos", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-x", LLM_PROVIDER: "Ollama" };
    expect(resolveLlmProvider(env)).toBe("ollama");
    expect(() => resolveLlmProvider({ LLM_PROVIDER: "gpt" })).toThrow();
  });
});
