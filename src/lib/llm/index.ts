import { ClaudeFlashcardGenerator } from "./claude-generator";
import { OllamaFlashcardGenerator } from "./ollama-generator";
import type { FlashcardGenerator } from "./types";

export type { FlashcardGenerator, GeneratedCard, GenerateFlashcardsInput } from "./types";
export { FlashcardValidationError } from "./claude-generator";

export type LlmProvider = "anthropic" | "ollama";

/** Which provider to use: LLM_PROVIDER if set, otherwise Claude when an API key is
 * configured and a local Ollama model when not -- so a fresh checkout works with no
 * paid key at all. */
export function resolveLlmProvider(
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "ollama") return explicit;
  if (explicit)
    throw new Error(`Unknown LLM_PROVIDER "${env.LLM_PROVIDER}" (use anthropic or ollama)`);
  return env.ANTHROPIC_API_KEY ? "anthropic" : "ollama";
}

/**
 * Single place that decides which LLM provider backs flashcard generation.
 * Everything else in the app calls this instead of constructing a generator
 * directly -- swapping providers means changing this one function.
 */
export function getFlashcardGenerator(): FlashcardGenerator {
  return resolveLlmProvider() === "ollama"
    ? new OllamaFlashcardGenerator()
    : new ClaudeFlashcardGenerator(process.env.ANTHROPIC_API_KEY);
}
