/**
 * Turns a flashcard-generation failure into a message a student can act on, instead
 * of a raw SDK dump like `401 {"type":"error","error":{...}}` (what the job used to
 * store and the UI used to show).
 *
 * Works from the status code and message text rather than `instanceof`: errors thrown
 * inside an Inngest step are serialized and re-created, so by the time the function's
 * catch block sees one it's a plain Error whose message starts with the HTTP status.
 */
export function describeGenerationError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const statusProp = (err as { status?: unknown } | null)?.status;
  const status =
    typeof statusProp === "number" ? statusProp : Number(message.match(/^(\d{3})\b/)?.[1]);

  if (status === 401 || /authentication_error|invalid x-api-key|api key/i.test(message)) {
    return "The AI service rejected the API key. Set a valid ANTHROPIC_API_KEY and try again.";
  }
  if (/credit balance/i.test(message)) {
    return "The Anthropic account is out of credits. Add credits, then try again.";
  }
  if (status === 403 || /permission_error/i.test(message)) {
    return "The API key doesn't have permission to use this model.";
  }
  if (status === 429 || /rate_limit/i.test(message)) {
    return "The AI service is busy right now. Try again in a minute.";
  }
  if (status === 529 || /overloaded/i.test(message)) {
    return "The AI service is overloaded right now. Try again in a few minutes.";
  }
  if (/record_flashcards|Invalid flashcards from model/i.test(message)) {
    return "The AI returned flashcards in an unexpected format. Try again.";
  }
  if (/prompt is too long|context/i.test(message) && status === 400) {
    return "These notes are too long to process in one go. Try a shorter document.";
  }
  return "Something went wrong while generating flashcards. Try again.";
}
