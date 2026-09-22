export interface GeneratedCard {
  question: string;
  answer: string;
}

export interface GenerateFlashcardsInput {
  text: string;
  /** Upper bound on how many cards to return. Defaults chosen by the implementation. */
  maxCards?: number;
}

/**
 * The only interface the rest of the app depends on for flashcard generation.
 * Nothing outside src/lib/llm/ imports the Anthropic SDK directly -- that's what
 * makes the provider swappable (a future OpenAiFlashcardGenerator could implement
 * the same interface) and makes this trivially mockable in tests (never hit a real
 * LLM API in CI).
 */
export interface FlashcardGenerator {
  generateFlashcards(input: GenerateFlashcardsInput): Promise<GeneratedCard[]>;
}
