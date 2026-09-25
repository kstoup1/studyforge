import { test, expect } from "@playwright/test";
import { startOfNextLocalDay } from "../src/lib/dates/time-zone";
import { createDeck, deleteUser, seedCards, signUp, uniqueEmail } from "./helpers";

// Runs the browser in a fixed zone well away from UTC, so "today" bugs that only
// show up when the user's calendar day differs from the server's UTC day are
// exercised on every run instead of only at certain times of day.
const TIME_ZONE = "America/Los_Angeles";
test.use({ timezoneId: TIME_ZONE });

const email = uniqueEmail("study");

test.afterAll(() => deleteUser(email));

test("study due cards (incl. later today), grade them, and see it on the dashboard", async ({
  page,
}) => {
  await signUp(page, email);
  const deckId = await createDeck(page, `Study deck ${Date.now()}`);

  // One card due "later today" in the user's zone: it must show up in today's
  // session (Anki-style), not only once that exact minute passes.
  const now = Date.now();
  const midnight = startOfNextLocalDay(new Date(now), TIME_ZONE).getTime();
  const laterToday = new Date(now + Math.min(60 * 60 * 1000, (midnight - now) / 2));
  const tomorrow = new Date(midnight + 60 * 60 * 1000);

  seedCards(deckId, [
    { question: "What is the powerhouse of the cell?", answer: "The mitochondria" },
    {
      question: "What does DNA stand for?",
      answer: "Deoxyribonucleic acid",
      dueAt: laterToday.toISOString(),
    },
    { question: "Not due until tomorrow", answer: "Hidden", dueAt: tomorrow.toISOString() },
  ]);

  // Dashboard before studying: 2 due today (not the tomorrow card), no streak yet.
  await page.goto("/dashboard");
  await expect(page.getByText("Due today").locator("..")).toContainText("2");
  await expect(page.getByText("0 days")).toBeVisible();

  await page.goto(`/decks/${deckId}/study`);
  await expect(page.getByText("2 card(s) left in this session")).toBeVisible();

  // The card is a real button, so it can be revealed from the keyboard.
  await page.getByRole("button", { name: "Reveal answer" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("The mitochondria")).toBeVisible();
  await page.getByRole("button", { name: "Good" }).click();

  await expect(page.getByText("1 card(s) left in this session")).toBeVisible();
  await expect(page.getByText("What does DNA stand for?")).toBeVisible();
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.getByRole("button", { name: "Easy" }).click();

  await expect(page.getByText("Done — reviewed 2 cards.")).toBeVisible();
  await expect(page.getByText("Not due until tomorrow")).not.toBeVisible();

  // Dashboard after: nothing left due today, and a 1-day streak.
  await page.goto("/dashboard");
  await expect(page.getByText("Due today").locator("..")).toContainText("0");
  await expect(page.getByText("1 day", { exact: true })).toBeVisible();

  // Re-opening the session shows nothing due (the graded cards were rescheduled).
  await page.goto(`/decks/${deckId}/study`);
  await expect(page.getByText("No cards are due right now.")).toBeVisible();
});
