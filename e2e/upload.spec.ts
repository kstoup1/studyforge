import { test, expect } from "@playwright/test";
import { createDeck, deleteUser, signUp, uniqueEmail } from "./helpers";

const email = uniqueEmail("upload");

test.afterAll(() => deleteUser(email));

test("oversized PDFs are rejected before upload with a clear message", async ({ page }) => {
  await signUp(page, email);
  const deckId = await createDeck(page, `Upload deck ${Date.now()}`);
  await page.goto(`/decks/${deckId}/upload`);

  await page.getByRole("button", { name: "Upload PDF" }).click();
  let uploadRequests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/uploads")) uploadRequests += 1;
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "huge-notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(5 * 1024 * 1024, "a"), // over the 4MB limit
  });
  await page.getByRole("button", { name: "Generate flashcards" }).click();
  await expect(page.getByText("That PDF is too large (max 4MB)")).toBeVisible();
  expect(uploadRequests).toBe(0); // never sent to the server

  // A non-PDF masquerading as one gets the server's readable error, not a silent hang.
  await page.locator('input[type="file"]').setInputFiles({
    name: "not-really.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("this is not a pdf"),
  });
  await page.getByRole("button", { name: "Generate flashcards" }).click();
  await expect(page.locator("p.text-red-600")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate flashcards" })).toBeEnabled();
});

// This environment deliberately has an invalid ANTHROPIC_API_KEY (see .env), so the
// real Inngest pipeline runs end to end and must land on a clean, visible failure
// instead of an endless spinner. Needs the Inngest dev server (npx inngest-cli dev).
test("pasted notes go through the background pipeline to a visible final state", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/decks$/);
  const deckId = await createDeck(page, `Pipeline deck ${Date.now()}`);

  await page.goto(`/decks/${deckId}/upload`);
  await page
    .getByPlaceholder("Paste your lecture notes here…")
    .fill("Photosynthesis converts light energy into chemical energy stored in glucose.");
  await page.getByRole("button", { name: "Generate flashcards" }).click();
  await expect(page.getByText(/Extracting text…|Generating flashcards…/)).toBeVisible();

  // With a real key this would be "Done — N flashcards created."; with the invalid
  // one it must be the failure panel with the reason and a working "Try again".
  const done = page.getByText(/Done — \d+ flashcards? created\./);
  const failed = page.getByText("Generation failed.");
  await expect(done.or(failed)).toBeVisible({ timeout: 120_000 });
  if (await failed.isVisible()) {
    // A readable reason, never a raw SDK/JSON dump.
    const reason = page.locator("p.text-red-700");
    await expect(reason).toBeVisible();
    await expect(reason).not.toContainText("{");
    await expect(reason).toContainText(/API key|credits|busy|overloaded|Try again/);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByPlaceholder("Paste your lecture notes here…")).toBeVisible();
  }
});
