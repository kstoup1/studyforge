import { test, expect } from "@playwright/test";
import { createDeck, deleteUser, signUp, uniqueEmail } from "./helpers";

// The success path of the core feature: notes in -> real flashcards out -> studied.
// Needs the app started against the mock Anthropic API (scripts/e2e/mock-anthropic.mjs)
// -- see README "Testing". Skipped otherwise, since with the real (or no) API key the
// outcome depends on credentials this test can't control.
const MOCK = "http://localhost:4010";
test.skip(process.env.E2E_MOCK_LLM !== "1", "set E2E_MOCK_LLM=1 and run the app against the mock");

// One user per test, so neither depends on the other (Playwright restarts the worker
// after a failure, which would otherwise hand the second test a fresh, unregistered email).
const emails: string[] = [];

test.afterAll(() => emails.forEach(deleteUser));

function newUserEmail(): string {
  const email = uniqueEmail("generate");
  emails.push(email);
  return email;
}

/** A real, multi-line PDF built by hand (same approach as the extract-text unit
 * test's fixture): one text line per Td, which unpdf joins with single newlines --
 * exactly the shape that used to defeat chunking. Lines must fit the page width:
 * pdf.js drops text positioned off the page. */
function buildPdf(lines: string[], linesPerPage = 50): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));

  // Objects: 1 catalog, 2 page tree, 3 font, then a (page, contents) pair per page.
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}]/Count ${pages.length}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  pages.forEach((pageLines, i) => {
    const ops = pageLines
      .map((l, j) => `BT /F1 8 Tf 30 ${760 - j * 14} Td (${l.replace(/[()\\]/g, "")}) Tj ET`)
      .join("\n");
    objects.push(
      `<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 3 0 R>>>>/MediaBox[0 0 612 792]/Contents ${5 + i * 2} 0 R>>`,
      `<</Length ${Buffer.byteLength(ops)}>>\nstream\n${ops}\nendstream`,
    );
  });
  const body = objects.map((o, i) => `${i + 1} 0 obj${o}\nendobj`).join("\n");
  return Buffer.from(
    `%PDF-1.4\n${body}\ntrailer<</Size ${objects.length + 1}/Root 1 0 R>>\n%%EOF`,
    "latin1",
  );
}

type MockRequest = {
  model: string;
  tool_choice: { type: string; name: string };
  messages: { content: string }[];
};

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`);
});

test("pasted notes become real flashcards that can be studied", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signUp(page, newUserEmail());
  const deckId = await createDeck(page, `Generated deck ${Date.now()}`);

  const notes = [
    "Photosynthesis converts light energy into chemical energy stored in glucose.",
    "It takes place mainly in the chloroplasts of plant cells.",
    "Chlorophyll absorbs mostly blue and red light and reflects green light.",
  ].join(" ");
  await page.goto(`/decks/${deckId}/upload`);
  await page.getByPlaceholder("Paste your lecture notes here…").fill(notes);
  await page.getByRole("button", { name: "Generate flashcards" }).click();

  await expect(page.getByText("Done — 3 flashcards created.")).toBeVisible({ timeout: 90_000 });

  // What the app actually sent through the real SDK.
  const sent: MockRequest[] = await (await request.get(`${MOCK}/__requests`)).json();
  expect(sent).toHaveLength(1);
  expect(sent[0].model).toBe("claude-sonnet-5");
  expect(sent[0].tool_choice).toEqual({ type: "tool", name: "record_flashcards" });
  expect(sent[0].messages[0].content).toBe(notes);

  // The cards are persisted, listed, and immediately studyable.
  await page.getByRole("link", { name: "View the deck" }).click();
  await expect(page.getByRole("heading", { name: "Cards (3)" })).toBeVisible();
  await expect(
    page.getByText("It takes place mainly in the chloroplasts of plant cells."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Study", exact: true }).click();
  await expect(page.getByText("3 card(s) left in this session")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.getByRole("button", { name: "Good" }).click();
  }
  await expect(page.getByText("Done — reviewed 3 cards.")).toBeVisible();
});

test("a large multi-line PDF is chunked and every chunk's cards are kept", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signUp(page, newUserEmail());
  const deckId = await createDeck(page, `PDF deck ${Date.now()}`);

  // 4 pages, 180 lines x ~80 chars = ~14k chars: over the 12k chunk size, no blank lines.
  const lines = Array.from(
    { length: 180 },
    (_, i) =>
      `Fact ${i + 1}: the electron transport chain pumps protons across the inner membrane.`,
  );
  await page.goto(`/decks/${deckId}/upload`);
  await page.getByRole("button", { name: "Upload PDF" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "lecture.pdf",
    mimeType: "application/pdf",
    buffer: buildPdf(lines),
  });
  await page.getByRole("button", { name: "Generate flashcards" }).click();
  await expect(page.getByText(/Done — \d+ flashcards created\./)).toBeVisible({ timeout: 90_000 });

  const sent: MockRequest[] = await (await request.get(`${MOCK}/__requests`)).json();
  expect(sent.length).toBeGreaterThan(1); // actually chunked
  for (const r of sent) expect(r.messages[0].content.length).toBeLessThanOrEqual(12_000);
  // Every line of every page reached the model, in order, split only at line breaks.
  expect(sent.map((r) => r.messages[0].content).join("\n")).toBe(lines.join("\n"));
});
