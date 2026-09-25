import { test, expect } from "@playwright/test";
import { PASSWORD, createDeck, deleteUser, signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" }); // the second test signs in as the first test's user

const email = uniqueEmail("account");
const mixedCaseEmail = email.replace("e2e-account", "E2E-Account").toUpperCase();

test.afterAll(() => deleteUser(email));

test("emails are case-insensitive for sign-up and sign-in", async ({ page }) => {
  await signUp(page, mixedCaseEmail);
  await expect(page.getByText(email, { exact: true })).toBeVisible(); // stored lowercased

  // Signed-in users visiting the auth pages are sent to their decks.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/decks$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");

  // Signing up again with a differently-cased address is rejected, not a new account.
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (min 8 characters)").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with that email already exists")).toBeVisible();

  // Sign in with a third casing.
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0); // not configured
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/decks$/);
});

test("deck editing: validation errors, clearing a description, cancel discards edits", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/decks$/);

  const title = `Editing deck ${Date.now()}`;
  await createDeck(page, title);

  // Add a description.
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Description").fill("Chapter 3 notes");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Chapter 3 notes")).toBeVisible();

  // A blank title shows a readable error instead of failing silently.
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Deck title").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Title is required")).toBeVisible();

  // Cancel discards the unsaved edit; reopening shows the saved title again.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByLabel("Deck title")).toHaveValue(title);
  await expect(page.getByText("Title is required")).toHaveCount(0);

  // Clearing the description actually clears it (it used to be silently kept).
  await page.getByLabel("Description").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Chapter 3 notes")).toHaveCount(0);
});
