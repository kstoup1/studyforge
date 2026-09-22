import { Inngest } from "inngest";

/** Shared Inngest client. Event payloads are validated with Zod where they're read
 * (src/inngest/functions/generate-flashcards.ts) rather than relying on Inngest's
 * own generic event-schema typing, so the validation logic lives in one obvious
 * place next to where it matters. */
export const inngest = new Inngest({ id: "studyforge" });

export const NOTES_UPLOADED_EVENT = "studyforge/notes.uploaded";

export interface NotesUploadedEventData {
  generationJobId: string;
}
