import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, request } from "@playwright/test";
import { cardsToAnkiTsv, cardsToCsv } from "../src/lib/export/card-export";

const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

// Cards normally reach a deck via the Inngest + Claude pipeline, which needs a real
// ANTHROPIC_API_KEY this environment doesn't have (see README's "Getting from here to
// deployed"). So this seeds two cards directly via Prisma, the same way
// scripts/seed-test-cards.ts does for manual testing, to exercise the actual export
// route (auth -> ownership-scoped query -> CSV/TSV formatting) against real database
// rows instead of only the pure cardsToCsv/cardsToAnkiTsv unit tests.
//
// Seeding/cleanup shells out to tsx scripts rather than importing the Prisma client
// directly -- see scripts/e2e/create-cards.ts for why.

const email = `e2e-export-${Date.now()}@example.com`;
const password = "correct horse battery staple";
const deckTitle = `Export test deck ${Date.now()}`;
const cards = [
  { question: "What is the capital of France?", answer: "Paris" },
  { question: "2 + 2?", answer: "4" },
];

test.afterAll(() => {
  execFileSync(process.execPath, [tsxCli, "scripts/e2e/delete-user.ts", email], {
    stdio: "inherit",
  });
});

test("exported CSV and Anki files match the deck's real cards", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (min 8 characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/decks$/);

  await page.getByPlaceholder("Deck title (e.g. Bio 201 midterm)").fill(deckTitle);
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByText(deckTitle).click();
  await expect(page).toHaveURL(/\/decks\/[^/]+$/);
  const deckId = new URL(page.url()).pathname.split("/").pop();
  if (!deckId) throw new Error("Could not read deckId from URL");

  execFileSync(
    process.execPath,
    [tsxCli, "scripts/e2e/create-cards.ts", deckId, JSON.stringify(cards)],
    { stdio: "inherit" },
  );
  await page.reload();
  await expect(page.getByText("What is the capital of France?")).toBeVisible();

  const csvResponse = await page.request.get(`/api/decks/${deckId}/export?format=csv`);
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()["content-type"]).toContain("text/csv");
  expect(await csvResponse.text()).toBe(cardsToCsv(cards));

  const ankiResponse = await page.request.get(`/api/decks/${deckId}/export?format=anki`);
  expect(ankiResponse.status()).toBe(200);
  expect(ankiResponse.headers()["content-type"]).toContain("text/plain");
  expect(await ankiResponse.text()).toBe(cardsToAnkiTsv(cards));

  // Unauthenticated requests must not be able to export -- checked with a fresh
  // request context that shares no cookies with the signed-in `page`.
  const anon = await request.newContext({ baseURL: "http://localhost:3000" });
  const anonResponse = await anon.get(`/api/decks/${deckId}/export?format=csv`);
  expect(anonResponse.status()).toBe(401);
  await anon.dispose();
});
