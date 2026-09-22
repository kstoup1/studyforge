import { describe, expect, it } from "vitest";
import { extractPdfText, PdfExtractionError } from "./extract-text";

// A minimal, hand-built, real PDF -- not mocked. pdf.js's recovery parser handles
// its missing xref table fine (real-world PDFs are often malformed in exactly this
// way, so this is a reasonable, low-effort fixture rather than a liability).
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 200 100]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 58>>
stream
BT /F1 24 Tf 20 50 Td (Hello StudyForge) Tj ET
endstream
endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;

describe("extractPdfText", () => {
  it("extracts real text from a real (if minimal) PDF", async () => {
    const bytes = new TextEncoder().encode(MINIMAL_PDF);
    const text = await extractPdfText(bytes);
    expect(text).toBe("Hello StudyForge");
  });

  it("throws PdfExtractionError on bytes that aren't a PDF at all", async () => {
    const bytes = new TextEncoder().encode("this is definitely not a pdf");
    await expect(extractPdfText(bytes)).rejects.toThrow(PdfExtractionError);
  });

  it("throws PdfExtractionError on an empty buffer", async () => {
    await expect(extractPdfText(new Uint8Array())).rejects.toThrow(PdfExtractionError);
  });
});
