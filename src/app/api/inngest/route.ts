import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateFlashcards } from "@/inngest/functions/generate-flashcards";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateFlashcards],
});
