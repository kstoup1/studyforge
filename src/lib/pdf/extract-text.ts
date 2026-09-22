import { extractText, getDocumentProxy } from "unpdf";

export class PdfExtractionError extends Error {}

/**
 * Extracts plain text from a PDF's raw bytes. Nothing is written to disk and the
 * buffer is never persisted -- see docs/PLAN.md §6 for why StudyForge only ever
 * keeps the extracted text, not the original file.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  try {
    const document = await getDocumentProxy(data);
    const { text } = await extractText(document, { mergePages: true });
    const trimmed = text.trim();
    if (!trimmed) {
      throw new PdfExtractionError("No extractable text found (the PDF may be scanned/image-only)");
    }
    return trimmed;
  } catch (err) {
    if (err instanceof PdfExtractionError) throw err;
    throw new PdfExtractionError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
