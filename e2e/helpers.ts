import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

// Prisma access goes through tsx child processes rather than direct imports -- see
// scripts/e2e/create-cards.ts for why.
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

export const PASSWORD = "correct horse battery staple";

/** A timestamp+random email so repeat and parallel runs never collide. */
export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (min 8 characters)").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/decks$/);
}

/** Creates a deck from the decks page, opens it, and returns its id. */
export async function createDeck(page: Page, title: string): Promise<string> {
  await page.goto("/decks");
  await page.getByPlaceholder("Deck title (e.g. Bio 201 midterm)").fill(title);
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/decks\/[^/]+$/);
  const deckId = new URL(page.url()).pathname.split("/").pop();
  if (!deckId) throw new Error("Could not read deckId from URL");
  return deckId;
}

export function seedCards(
  deckId: string,
  cards: { question: string; answer: string; dueAt?: string }[],
) {
  execFileSync(
    process.execPath,
    [tsxCli, "scripts/e2e/create-cards.ts", deckId, JSON.stringify(cards)],
    { stdio: "inherit" },
  );
}

export function deleteUser(email: string) {
  execFileSync(process.execPath, [tsxCli, "scripts/e2e/delete-user.ts", email], {
    stdio: "inherit",
  });
}
