import { ClaudeFlashcardGenerator } from "./claude-generator";
import type { FlashcardGenerator } from "./types";

export type { FlashcardGenerator, GeneratedCard, GenerateFlashcardsInput } from "./types";
export { FlashcardValidationError } from "./claude-generator";

/**
 * Single place that decides which LLM provider backs flashcard generation.
 * Everything else in the app calls this instead of constructing
 * ClaudeFlashcardGenerator directly -- swapping providers later (or injecting a
 * fake in tests) means changing this one function, not every call site.
 */
export function getFlashcardGenerator(): FlashcardGenerator {
  return new ClaudeFlashcardGenerator(process.env.ANTHROPIC_API_KEY);
}
