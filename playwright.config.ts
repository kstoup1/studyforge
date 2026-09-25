import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker: every test hits the same local `prisma dev` database, which only
  // handles a single connection at a time (see src/lib/db.ts). Parallel workers
  // (plus their tsx seeding scripts) caused random 08P01 protocol errors.
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuses a dev server that's already running (the common case in this repo); starts
  // one otherwise. Turbopack (the plain `dev` script) can't run on this machine's
  // Application Control policy -- see README's "A real gap" section -- so this uses
  // the webpack fallback.
  webServer: {
    command: "npm run dev:webpack",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
