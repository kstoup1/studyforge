import { test, expect } from "@playwright/test";
import { createDeck, deleteUser, signUp, uniqueEmail } from "./helpers";

// The Canvas import, end to end, against scripts/e2e/mock-canvas.mjs (a fake Canvas
// plus a separate fake file-storage origin) and the mock Anthropic API. Needs the app
// started with CANVAS_ALLOW_INSECURE_URLS=1 and ANTHROPIC_BASE_URL pointed at the
// mock -- see README "Testing". Skipped otherwise.
test.skip(
  process.env.E2E_MOCK_CANVAS !== "1" || process.env.E2E_MOCK_LLM !== "1",
  "set E2E_MOCK_CANVAS=1 and E2E_MOCK_LLM=1 and run the app against both mocks",
);

const CANVAS = "http://localhost:4020";
const TOKEN = "fake-canvas-token-for-e2e-tests-0123456789";
const email = uniqueEmail("canvas");

test.afterAll(() => deleteUser(email));

test("connect Canvas, import a lecture PDF and a page, and get flashcards", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await signUp(page, email);

  // --- Connect: a bad token is rejected with a readable reason, a good one works.
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/canvas$/);
  await page.getByLabel("Your school's Canvas address").fill(CANVAS);
  await page.getByLabel("Access token").fill("this-token-is-wrong-and-long-enough");
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  await expect(page.getByText(/rejected the access token/)).toBeVisible();

  await page.getByLabel("Access token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect Canvas" }).click();
  await expect(page.getByText("Connected as Test Student")).toBeVisible();

  // --- Import into a deck.
  const deckId = await createDeck(page, `Biology ${Date.now()}`);
  await page.getByRole("link", { name: "Import from Canvas" }).click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}/canvas$`));

  const courseSelect = page.getByLabel("Course");
  // Both pages of the paginated course list arrived.
  await expect(courseSelect.locator("option", { hasText: "Art History" })).toHaveCount(1);
  await courseSelect.selectOption({ label: "Biology 101" });

  // Files reached via modules even though the Files tab is hidden (403) for students.
  await expect(page.getByText("Week 3 - Energy")).toBeVisible();
  const pdf = page.getByLabel(/Lecture 3 - Cellular Respiration\.pdf/);
  const reading = page.getByLabel(/Photosynthesis summary/);
  const slides = page.getByLabel(/Lecture 3 slides\.pptx/);
  await expect(slides).toBeDisabled(); // unsupported type can't be picked
  await pdf.check();
  await reading.check();
  await page.getByRole("button", { name: "Import 2 selected" }).click();

  // Each item runs through the real pipeline and reports its own result.
  await expect(page.getByText(/\d+ flashcards? created/)).toHaveCount(2, { timeout: 90_000 });

  await page.getByRole("link", { name: "View the deck" }).click();
  // Cards came from the PDF's text and from the page's HTML (entities decoded).
  await expect(
    page.getByText("Glycolysis splits glucose into two pyruvate molecules in the cytoplasm."),
  ).toBeVisible();
  await expect(page.getByText("The light reactions split water & release oxygen.")).toBeVisible();

  // --- The token went to Canvas, never to the file-storage origin it redirected to.
  const log: { server: string; path: string; auth: string | null }[] = await (
    await request.get(`${CANVAS}/__requests`)
  ).json();
  const storageHits = log.filter((r) => r.server === "storage");
  expect(storageHits.length).toBeGreaterThan(0);
  expect(storageHits.every((r) => r.auth === null)).toBe(true);
  expect(log.some((r) => r.server === "canvas" && r.auth === `Bearer ${TOKEN}`)).toBe(true);

  // --- Disconnect: the importer asks to connect again.
  await page.goto("/settings/canvas");
  await page.getByRole("button", { name: "Disconnect Canvas" }).click();
  await expect(page.getByRole("button", { name: "Connect Canvas" })).toBeVisible();
  await page.goto(`/decks/${deckId}/canvas`);
  await expect(page.getByText("Canvas isn't connected yet.")).toBeVisible();
});
