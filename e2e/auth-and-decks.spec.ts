import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "@playwright/test";

const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

// A real end-to-end regression test of the flow that was originally verified by hand
// with browser automation during Phase 1 (see README's "What's built so far"). Uses a
// timestamp-unique email so repeat runs never collide with each other or with the
// seeded test.student@example.com account, and cleans up the user it creates.
//
// Cleanup shells out to a tsx script rather than importing the Prisma client directly
// -- the generated client is ESM-only (uses import.meta) and can't load through
// Playwright's default CJS test transform. See scripts/e2e/delete-user.ts.

const email = `e2e-auth-${Date.now()}@example.com`;
const password = "correct horse battery staple";
const deckTitle = `Playwright deck ${Date.now()}`;
const renamedTitle = `${deckTitle} (renamed)`;

test.afterAll(() => {
  // The test also deletes the deck through the UI on the happy path; this is just a
  // safety net so a failed run doesn't leave a stray test user behind.
  execFileSync(process.execPath, [tsxCli, "scripts/e2e/delete-user.ts", email], {
    stdio: "inherit",
  });
});

test("sign up, create/rename/delete a deck, sign out, sign back in", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (min 8 characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/decks$/);

  await page.getByPlaceholder("Deck title (e.g. Bio 201 midterm)").fill(deckTitle);
  await page.getByRole("button", { name: "New deck" }).click();
  await expect(page.getByText(deckTitle)).toBeVisible();

  await page.getByText(deckTitle).click();
  await expect(page).toHaveURL(/\/decks\/[^/]+$/);
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox").first().fill(renamedTitle); // title input, before description
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamedTitle })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");

  await page.goto("/decks");
  await expect(page).toHaveURL(/\/sign-in$/); // unauthenticated visitor is redirected

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/decks$/);
  await expect(page.getByText(renamedTitle)).toBeVisible(); // persisted across sign-out

  await page.getByText(renamedTitle).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page).toHaveURL(/\/decks$/);
  await expect(page.getByText(renamedTitle)).not.toBeVisible();
});
