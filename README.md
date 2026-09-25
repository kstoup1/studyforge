# StudyForge

An AI-powered spaced-repetition study tool. Upload or paste your lecture notes, get
back auto-generated flashcards, and study them with an SM-2 scheduler (the same
algorithm behind Anki) that tracks what you actually know and re-surfaces cards right
before you'd forget them.

Full architecture/design plan: see `docs/PLAN.md`. This README is both setup
instructions and a running log of the real engineering decisions behind the project —
written to double as interview prep, not just documentation.

## Status

Phases 0-5 done: auth, decks, the AI generation pipeline, SM-2 study sessions, the
dashboard, and CSV/Anki export -- plus a **Canvas LMS integration** (connect your
school's Canvas and turn lecture PDFs and course pages into flashcards). 111 unit
tests (Vitest) plus 10 Playwright end-to-end tests, all passing -- against the dev server from a cold start _and_ against a real
**production build** (`next build` + `next start`). That includes the full success
path of the core feature (notes -> generated flashcards -> studied), using a local
mock of the Anthropic API since no real key has been used yet. Remaining: deploying to
Vercel/Neon (needs your own accounts -- see "Getting from here to deployed" below).
See "What's built so far" for the full list and "Hardening pass" for the bugs that
testing turned up and how each was fixed.

## Stack

- **Next.js 16** (App Router, TypeScript) — Server Actions for mutations, Route
  Handlers for uploads/webhooks/polling.
- **Postgres via Prisma 7**, using the new driver-adapter pattern (`@prisma/adapter-pg`)
  — no `DATABASE_URL` in the schema file anymore; the adapter is constructed explicitly
  in `src/lib/db.ts`.
- **Pluggable LLM backend** for flashcard generation (`src/lib/llm/`): **Claude**
  (Anthropic API) or a **local model via Ollama** (free, no API key, notes never
  leave the machine). See "Choosing the AI" below.
- **Inngest** for background job processing (note extraction + generation runs as a
  durable, retryable, step-based pipeline instead of blocking a request — see "Why
  these choices" below).
- **Auth.js (NextAuth) v5** with the Prisma Adapter — Google OAuth + email/password.
- **Vitest** for unit tests, **Playwright** for end-to-end tests.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values (see comments in that file)
```

### Local database

This project targets Postgres. For local dev, the fastest path is Prisma's own local
dev server (no Docker/signup required):

```bash
npx prisma dev -d -n studyforge   # starts a detached local Postgres, prints a connection URL
```

Copy the `postgres://...` (TCP) URL it prints into `.env`'s `DATABASE_URL`, using
whatever database name you want (Prisma will create it automatically the first time you
migrate). Then:

```bash
npm run db:migrate   # applies prisma/schema.prisma to your local DB
npm run db:generate  # regenerates the Prisma client into src/generated/prisma
```

`prisma dev` runs PGlite, which handles only one connection at a time, so also set
`DATABASE_POOL_MAX=1` in `.env` (already in `.env.example`). Without it, concurrent
requests fail at random with Postgres error `08P01` ("bind message supplies N
parameters…"). Leave it unset for a real hosted Postgres.

`npx prisma dev ls` / `npx prisma dev stop` manage the local server. In production this
points at a real hosted Postgres (Neon).

### Background jobs (Inngest)

Flashcard generation runs through Inngest. For local dev, no account is needed:

```bash
npx inngest-cli dev   # starts a local dev server at http://localhost:8288
```

Set `INNGEST_DEV="1"` in `.env` so the app's Inngest client talks to that local server
instead of defaulting to "cloud mode" (which otherwise complains about a missing
signing key even though nothing needs one locally). With `npm run dev` also running,
Inngest auto-discovers and syncs the app's functions — no manual registration step.

You'll also need a real `ANTHROPIC_API_KEY` in `.env` (from
https://console.anthropic.com/) for generation to actually produce flashcards — without
one, uploads will reach the pipeline and fail with a real (visible, not silent) error
from Anthropic once they get to the generation step.

### Running it

```bash
npm run dev
```

**If you're on a machine with a restrictive Application Control / code-signing policy**
(this happened during development on Windows): Next.js 16 defaults to Turbopack, which
needs native platform bindings. If those are blocked, you'll see
`An Application Control policy has blocked this file` and Turbopack will refuse to run
at all. Use `npm run dev:webpack` / `npm run build:webpack` instead (falls back to
WASM-based SWC + webpack). Note: on at least one such machine, `build:webpack`
specifically hit a WASM-hashing crash when bundling the generated Prisma client — dev
mode was unaffected. This is a local-machine workaround only; CI and Vercel run on
normal Linux with native bindings available, so they use the real `npm run build`
(Turbopack) without issue.

### Tests

```bash
npm test          # run once
npm run test:watch
```

## What's built so far

- Project scaffolded (Next.js 16, TypeScript, Tailwind, ESLint + Prettier, Vitest).
- Prisma schema for the full domain model (users/auth, decks, note sets, generation
  jobs, cards, SM-2 schedule state, append-only review log) — see `prisma/schema.prisma`.
- `src/lib/db.ts` — Prisma client singleton using the v7 driver-adapter pattern, reused
  across dev hot-reloads so `next dev` doesn't exhaust DB connections on every save.
- **`src/lib/sm2/sm2.ts`** — SM-2 spaced-repetition scheduling as a pure, dependency-free
  function (`computeNextSchedule`). 23 unit tests in `sm2.test.ts` covering every grade
  on a first review, the ease-factor floor, interval progression on repeated success,
  and lapse behavior after a long streak — verified against hand-derived expected values
  from the actual SM-2 formula (caught and fixed one arithmetic error in the test data
  itself this way, which is exactly the point of writing the tests against independently
  worked-out numbers rather than just "whatever the code outputs").
- GitHub Actions CI workflow written (`.github/workflows/ci.yml` on disk): lint, format
  check, Prisma generate, unit tests, build. **Not currently tracked in git** — the
  `gh` CLI's saved token lacks the `workflow` scope needed to push files under
  `.github/workflows/`, and granting it needs interactive browser approval. Re-add with
  `git add .github/workflows/ci.yml` once `gh auth refresh -h github.com -s workflow`
  has been approved.
- **Auth.js v5** (`src/lib/auth.ts`): Google OAuth + Credentials (email/password,
  bcrypt-hashed) providers, Prisma Adapter, **JWT session strategy** — see "Why these
  choices" below for why this overrides the original plan's "database sessions" idea.
  Registration is hand-rolled (`src/actions/auth.ts`'s `registerUser`) since Auth.js's
  Credentials provider only handles sign-_in_, not account creation.
- **Deck management** (`src/actions/decks.ts`): create/rename/delete/list, all scoped
  to the logged-in user via a compound `{id, userId}` Prisma filter (atomic
  ownership-checked writes, not a separate read-then-check). Pages: `/`, `/sign-up`,
  `/sign-in`, `/decks`, `/decks/[deckId]`.
- **Verified live in a real browser, not just "looks right in code"**: sign up → land
  on `/decks` already authenticated → create a deck → rename it → sign out → confirm
  `/decks` redirects an unauthenticated visitor to `/sign-in` → sign back in with the
  same password → confirm the renamed deck persisted → delete it → confirm it's gone.
  Full round trip, every step actually clicked through with browser automation.
- **`src/lib/llm/`** — flashcard generation behind a `FlashcardGenerator` interface
  (`types.ts`), implemented by `ClaudeFlashcardGenerator` (`claude-generator.ts`) using
  Anthropic tool-use forced output + Zod validation + text chunking (paragraph-boundary
  splitting for notes over ~12k characters) + exponential-backoff retry. 32 unit tests,
  all against a mocked SDK client (never hits a real API in CI) using the SDK's _real_
  `APIError` class for realistic error shapes.
- **`src/lib/pdf/extract-text.ts`** — PDF text extraction via `unpdf`, tested against a
  real (if minimal) hand-built PDF fixture, not mocked.
- **The Inngest background pipeline** (`src/inngest/functions/generate-flashcards.ts`):
  `POST /api/uploads` (PDF or pasted text) creates a `NoteSet` + `GenerationJob` and
  fires an event; the Inngest function runs `load-note-set` → `mark-processing` →
  `generate-cards` → `persist-cards` as independent steps, updating job status/stage
  as it goes. `GET /api/jobs/:id` (polled every 2s by the upload UI) reports progress.
  Deploy target is Vercel + Inngest Cloud; local dev uses `npx inngest-cli dev` (no
  account needed) — see Setup below.
- **Live-tested the real pipeline, not just the unit tests**: signed in, created a
  deck, pasted real text, watched it flow through `POST /api/uploads` → a real Inngest
  event → real step execution → a **real** call to the Anthropic API (with a
  deliberately invalid key, since no real key was available in that session) → a real
  401 → the job correctly landing in `FAILED` with the actual error message shown in
  the UI. This exercised everything except a successful model response, which the LLM
  module's 32 unit tests cover separately. **Doing this live testing directly caught a
  real bug** — see "Why these choices" below.
- **The study session** (`src/actions/reviews.ts`'s `submitReview`, `src/actions/
cards.ts`'s `getDueCards`, `src/components/study/study-session.tsx`): a thin
  Server Action wraps the already-tested pure `computeNextSchedule` — load
  `CardScheduleState`, call it, write the result back + an append-only `ReviewLog`
  row, atomically. Every `Card` gets a `CardScheduleState` created alongside it in
  the Inngest pipeline's `persist-cards` step (via `createManyAndReturn`), so
  "due cards" queries never have to null-check or lazily create scheduling state.
- **Live-tested the full study loop with real graded reviews, not just the SM-2 unit
  tests**: seeded a deck with real cards (`scripts/seed-test-cards.ts` — no API key
  needed), reviewed one with "Good" (grade 4) and one with "Again" (grade 0) through
  the actual browser UI, then queried the database directly. Results matched the
  pure function's independently-verified math exactly: grade 4 → ease factor stayed
  2.5, interval 1 day, repetitions 0→1; grade 0 → ease factor dropped to 1.7 (the
  same value hand-derived in the SM-2 test suite), interval reset to 1, repetitions
  stayed 0. A third, not-yet-due card was correctly left untouched throughout.
- **Dashboard** (`/dashboard`, `src/actions/dashboard.ts`, `src/lib/dashboard/
stats.ts`): cards due today (across all decks), a study streak (consecutive days
  with at least one review -- "haven't reviewed yet today" doesn't break a streak
  from yesterday, only a full skipped day does), and per-deck mastery % (cards with
  2+ successful repetitions or a 21+ day interval). `stats.ts` is pure and
  independently unit-tested (13 tests) the same way as `sm2.ts`. Live-verified against
  real seeded/reviewed data: due-today, streak, and mastery % all matched hand
  calculation exactly on the actual dashboard page.
- **CSV/Anki export** (`src/lib/export/card-export.ts`, `GET /api/decks/[deckId]/export`):
  pure `cardsToCsv`/`cardsToAnkiTsv` functions (RFC 4180 quoting for CSV; tabs/newlines
  collapsed to spaces/`<br>` for Anki's unquoted tab-separated plain-text import format),
  11 unit tests covering the escaping edge cases. The route handler reuses the same
  auth-then-ownership-scoped-query pattern as `uploads`/`jobs`, verified with the same
  unauthenticated-401 check. "Export CSV" / "Export for Anki" buttons on the deck page.

## Choosing the AI

`LLM_PROVIDER` in `.env` picks who writes the flashcards; leave it empty to use Claude
when `ANTHROPIC_API_KEY` is set and Ollama otherwise.

|                 | Claude (`anthropic`)             | Ollama (`ollama`)                                            |
| --------------- | -------------------------------- | ------------------------------------------------------------ |
| Cost            | Paid per use (cents per lecture) | Free                                                         |
| Setup           | API key                          | [Install Ollama](https://ollama.com), `ollama pull llama3.1` |
| Privacy         | Notes sent to Anthropic          | Notes never leave your machine                               |
| Works on Vercel | Yes                              | No -- needs a machine running Ollama                         |

Both implement the same `FlashcardGenerator` interface and share chunking, dedupe,
the card cap, and zod validation (`src/lib/llm/chunking.ts`). Claude gets structured
output via forced tool use; Ollama via its `format` JSON-schema option, which
constrains decoding to valid JSON -- much more reliable with an 8B model than prompt
instructions alone. Ollama uses smaller chunks (6k chars) and an explicit 8k context
window (its default is far smaller), and retries a malformed sample once.

Measured on an RTX 3070 with `llama3.1` (8B), on real lecture PDFs imported from
Canvas: 8 cards in 8-16s for ~3-4k-character slide decks, 33 cards in 33s for a
19k-character lecture.

## Canvas integration

Students connect their school's Canvas with a **personal access token** (Canvas →
Account → Settings → _+ New Access Token_) on the **Canvas** page. Then any deck has
**Import from Canvas**: pick a course, check lecture PDFs and course pages (grouped by
module), and each becomes its own generation job in the existing pipeline.

- **Read-only, minimal client** (`src/lib/canvas/client.ts`): users/self, courses,
  modules, files, pages, file download. Nothing is ever written to Canvas.
- **Token security**: encrypted at rest with AES-256-GCM, key derived from
  `AUTH_SECRET` via HKDF (`src/lib/canvas/token-crypto.ts`); verified against Canvas
  before it's saved; sent _only_ to the connected Canvas origin -- pagination links to
  other hosts are refused, and file downloads drop the `Authorization` header when
  Canvas redirects to its separate file-storage domain.
- **SSRF guard**: the Canvas address must be https and a public hostname (no
  localhost, IPs, `.local`/`.internal`). The only escape hatch,
  `CANVAS_ALLOW_INSECURE_URLS=1`, is for the local fake Canvas and is ignored in
  production.
- **Real-world Canvas quirks handled**: courses are paginated (Link headers); many
  instructors hide the Files tab from students (403), so materials are discovered
  through modules too; locked files are skipped; downloads are size-capped at 25MB.
- **Why personal tokens, not OAuth**: a "Connect with Canvas" OAuth button needs a
  developer key issued by each school's Canvas admins -- not something a student
  project can get. Tokens work at any school that allows them (Auburn does).
- Only PDFs and Canvas pages are imported for now; PowerPoint files are listed but
  disabled.

## Testing

```bash
npm test            # Vitest unit tests (pure logic: SM-2, streaks, time zones, chunking, export)
npm run test:e2e    # Playwright, against a running app on :3000 (starts `dev:webpack` if none)
```

The e2e suite needs the local database and the Inngest dev server running (see Setup).
It covers sign-up/sign-in (incl. case-insensitive emails), deck CRUD and validation,
studying due cards and the dashboard (run in `America/Los_Angeles` on purpose -- see
below), CSV/Anki export incl. the unauthenticated 401, upload limits, and the real
upload -> Inngest -> Claude pipeline reaching a visible final state. Workers are
pinned to 1 because every test shares the single-connection local database.

**Canvas without a real Canvas.** `scripts/e2e/mock-canvas.mjs` is a fake Canvas (port 4020) plus a separate fake file-storage origin (4021), mirroring the real API shapes
and quirks above; it logs the `Authorization` header of every request, so the e2e test
proves the token never reaches the storage origin. Run it alongside the Anthropic mock
(`npm run mock:canvas`), start the app with `CANVAS_ALLOW_INSECURE_URLS=1` as well, and
add `E2E_MOCK_CANVAS=1` to the test command.

**Testing successful generation without an API key.** `scripts/e2e/mock-anthropic.mjs`
is a dependency-free stand-in for the Messages API. The app talks to it through the
real Anthropic SDK (which honours `ANTHROPIC_BASE_URL`), so everything except the
model itself runs for real: the SDK request, the forced `tool_use` response, zod
validation, chunking, persistence, and studying the new cards. It records each
request, so the tests also check what the app sent (model, `tool_choice`, and that a
4-page PDF is split into chunks of at most 12k characters with nothing lost).

```bash
npm run mock:anthropic                                   # terminal 1, port 4010
ANTHROPIC_BASE_URL=http://localhost:4010 npm run dev:webpack   # terminal 2
E2E_MOCK_LLM=1 npm run test:e2e                          # terminal 3: all 9 tests
```

Without `E2E_MOCK_LLM=1` the two generation-success tests are skipped (the other
upload test accepts either outcome, since it depends on the real key). Don't leave
`ANTHROPIC_BASE_URL` set once you have a real key.

To run it against a production build instead of the dev server:

```bash
npm run build:webpack && npx next start -p 3000   # then, in another terminal:
npm run test:e2e
```

## Production build: verified

The production build now completes and the full e2e suite passes against it. An
earlier session hit a `WasmHash` `TypeError` inside webpack and recorded it as an
unexplained gap. Isolating it (building into a separate `distDir`, with and without
webpack's persistent cache, with and without a copy of the dev server's cache) showed
the cause: **running `next build` while `next dev` was running** -- both use `.next/`,
the dev server rewrote files mid-build, and webpack's filesystem snapshot hashed a
file that had vanished (`hash.update(undefined)`). Stop the dev server before
building and it's clean. Turbopack (`npm run build`, what Vercel uses) still can't
run on this particular machine's Application Control policy, but the app code itself
is proven to build, type-check, and run in production mode.

## Hardening pass

Bugs found by reading the code critically, writing e2e tests for the edge cases, and
running the suite against a production build -- each one fixed and covered by a test:

- **Sign-up could fail on a cold server with `MissingCSRF`** ("Account created, but
  sign-in failed"). Auth.js mints a new CSRF cookie on any auth request that arrives
  without one, so a slow `/api/auth/session` request (from the client
  `SessionProvider`, slow because the route was compiling or cold-starting) could
  land after the client fetched its CSRF token and overwrite the cookie. Fixed by
  moving sign-in/up/out to Server Actions (Auth.js's server-side `signIn`/`signOut`,
  protected by Next's own Origin check -- no token round trip to race) and making the
  nav bar a Server Component, which also removed `SessionProvider` and its polling.
  Verified with four back-to-back cold restarts (fresh `.next`), all green.
- **Streaks and "due today" used UTC days, not the student's.** At UTC-7, studying at
  8am Monday and 6pm Tuesday landed on UTC Monday and UTC _Wednesday_: a broken
  streak. And a card scheduled "1 day" after a 6pm review stayed hidden until 6pm
  the next day. Now the browser reports its IANA time zone in a cookie
  (`src/components/time-zone-cookie.tsx`, validated server-side), streaks count
  local calendar days, and anything due before the user's local midnight is
  studyable today, like Anki. The date math (`src/lib/dates/time-zone.ts`) is pure
  and tested across month/year boundaries and both DST transitions.
- **Random 500s and failed sign-ins under concurrent load (Postgres error `08P01`).**
  Local `prisma dev` is PGlite, which handles one connection at a time; the `pg` pool
  opened several and their protocol messages interleaved. Fixed with an opt-in
  `DATABASE_POOL_MAX` (1 locally, unset in production) and a single e2e worker.
- **Sign-in completely broken under `next start`.** Auth.js rejects every request
  with `UntrustedHost` in production mode unless it's on Vercel or `AUTH_TRUST_HOST`
  is set. Only visible by running the e2e suite against a production build.
- **PDFs were never actually chunked.** `unpdf` output has single newlines and no
  blank lines, and `chunkText` only split on blank lines -- so a whole PDF went to
  the model as one chunk. It now falls back to line breaks, then sentence ends, then
  a hard cut, and never exceeds the chunk size.
- **Uploads could hang or fail silently.** Vercel rejects request bodies over 4.5MB
  with a non-JSON page, so the 15MB limit was unreachable and `res.json()` threw.
  Now: a 4MB limit shared by client and server (checked before uploading), safe
  JSON parsing, a failed job instead of a stuck one if the Inngest event can't be
  sent, and a polling timeout with a helpful message instead of an endless spinner.
- **Deck descriptions couldn't be cleared** (blank was sent as `undefined`, which
  Prisma treats as "don't change"), and **validation errors vanished in production**
  (Next.js strips thrown Server Action messages) -- deck actions now return
  `{ ok, error }` and the UI shows it.
- **`Foo@x.com` and `foo@x.com` could be two different accounts.** Emails are now
  lowercased on sign-up and matched case-insensitively on sign-in; a concurrent
  duplicate sign-up gets the friendly error instead of a crash.
- Smaller: failed saves in the study session now show an error and allow a retry;
  the flashcard is a real keyboard-accessible button; "Continue with Google" is
  hidden unless Google OAuth is configured; signed-in users visiting the sign-in
  page go to their decks; cancelling a deck edit discards the unsaved changes;
  cards list in creation order.

### Creating migrations with `prisma dev`

`prisma migrate dev` fails against the local PGlite server (its shadow-database step
re-applies old migrations onto the same database: `type "SourceType" already exists`).
Create migrations by diffing instead, with the dev server stopped (one connection):

```bash
mkdir prisma/migrations/<timestamp>_<name>
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy && npx prisma generate
```

## Getting from here to deployed

Everything above runs and has been tested locally. To go from that to a live,
deployed app, you'll need to do these yourself (all need your own accounts/identity,
which is why they were left for you rather than attempted automatically):

1. **Push the CI workflow.** `.github/workflows/ci.yml` exists on disk but isn't
   tracked in git yet -- the `gh` CLI's saved token lacks the `workflow` scope. Run
   `gh auth refresh -h github.com -s workflow` (approves in your browser), then
   `git add .github/workflows/ci.yml && git commit -m "Add CI workflow" && git push`.
   CI will be the first run of the Turbopack build (`npm run build`), which can't run
   on this machine -- the webpack production build is verified (see above).
2. **Get a real `ANTHROPIC_API_KEY`** from https://console.anthropic.com/ and put it
   in `.env` (local) and your Vercel project's env vars (deployed) -- generation has
   only been tested against a mocked SDK client and, live, against a deliberately
   invalid key (which correctly failed). A real key has never been used in this
   session, so a real successful generation is the first thing worth trying once you
   have one.
3. **Create a Neon Postgres database** (https://neon.tech/, free tier) for
   production. Run `npm run db:migrate` against it (or `prisma migrate deploy` in
   CI/CD) to apply the schema.
4. **Deploy to Vercel** (https://vercel.com/, free tier): import the GitHub repo, set
   `DATABASE_URL` (Neon), `ANTHROPIC_API_KEY`, `AUTH_SECRET` (reuse or regenerate),
   **not** `DATABASE_POOL_MAX` (that's only for the local single-connection database),
   `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (step 5) and `INNGEST_EVENT_KEY`/
   `INNGEST_SIGNING_KEY` (step 6) as environment variables.
5. **(Optional) Set up Google OAuth** at
   https://console.cloud.google.com/apis/credentials if you want "Continue with
   Google" to actually work -- email/password sign-in works fully without it.
6. **Set up Inngest Cloud** (https://app.inngest.com/, free tier) for production
   background jobs -- connect it to your deployed Vercel URL and set the two
   `INNGEST_*` env vars from step 4.
7. **Smoke-test the deployed app end-to-end**: sign up, create a deck, paste real
   notes, confirm real flashcards actually generate (the one thing never tested with
   a real API key in this session), study them, check the dashboard.

## Why these choices

Written so this doubles as interview prep, not just a decision log.

- **Prisma driver adapters over the old implicit `url` config**: Prisma 7 removed
  `datasource.url` from the schema file entirely — connection strings now go through
  `prisma.config.ts` for the CLI, and an explicit adapter (`PrismaPg`) constructed in
  application code for the runtime client. More explicit, and it's what makes Prisma's
  newer edge/serverless-friendly connection modes possible.
- **Inngest for background jobs, not an inline request**: PDF parsing + a chunked LLM
  call realistically takes 10-40+ seconds, which risks Vercel's serverless execution
  limits (10s Hobby / 60s Pro) and is bad UX to block a request on. Inngest turns note
  upload into a durable, step-based pipeline (`extract-text` → `generate` →
  `persist-cards`), each step independently retried on failure, with no infrastructure
  to self-host (no Redis, no worker process). The client polls a job-status row for
  progress instead of needing websockets.
- **SM-2, not a fancier algorithm like FSRS**: well-documented, small well-defined
  state, and the reference point most people (including interviewers) already
  recognize from Anki. FSRS is more accurate but a much bigger implementation risk for
  a solo, time-boxed project.
- **The SM-2 module has zero framework imports** (no Prisma, no Next.js) and takes
  `now` as a parameter instead of reading the clock internally. That's what makes it
  fully deterministic and trivial to unit test — and it's a clean example of separating
  pure logic from I/O, which the `submitReview` Server Action is a thin wrapper around.
- **Not persisting raw uploaded PDFs**: only the extracted text is stored. Nothing
  downstream needs the original file bytes, and skipping file storage removes a whole
  subsystem (blob storage, signed URLs, size/cleanup policy) with no feature payoff.
  Deliberate scope decision, not a corner cut — see `docs/PLAN.md` §6 for the fuller
  reasoning and what adding it back later would look like.
- **Local Postgres for dev via `npx prisma dev`, not Docker**: this machine's Docker
  Desktop daemon wasn't running and starting the full GUI app was unnecessary friction;
  Prisma's own managed local dev server does the same job with zero extra setup once
  Prisma itself is installed.
- **JWT session strategy, not database sessions**: the original plan called for database
  sessions ("Postgres is already there, simpler revocation"). Turns out Auth.js
  _requires_ the JWT strategy whenever a Credentials provider is configured — there's no
  OAuth-redirect-driven flow for password sign-in to hang a database session off of, and
  it throws (`MissingAdapter`-style error) if you try. Verified against `@auth/core`'s
  own type definitions and error messages, not assumed. JWT is also just the more common
  real-world pairing with a Credentials provider, so this isn't a downgrade — it's the
  actually-supported combination for this feature set, and a good interview answer for
  "why not database sessions here."
- **In-page delete confirmation, not `window.confirm()`**: a native `confirm()` dialog
  blocks the JS thread and can't be styled — replaced with an in-component confirm
  step (`DeckActions`'s `mode: "confirming-delete"`). Better UX, and it's also what made
  the delete flow safely testable with browser automation (native dialogs block that
  too).
- **Watch for the `auth` npm package name trap**: `npx auth secret` (a command
  suggested by Auth.js's own docs in some places) actually installs and runs a
  _different_ library called Better Auth, not Auth.js/NextAuth — it prints
  `BETTER_AUTH_SECRET`, which Auth.js never reads. Generate `AUTH_SECRET` directly
  instead: `node -e "console.log(require('crypto').randomBytes(33).toString('base64'))"`.
- **A real bug the live pipeline test caught: permanent errors were being retried
  needlessly.** The LLM module's own retry wrapper (3 attempts, exponential backoff)
  didn't distinguish a permanent failure (401 invalid key, 403 forbidden, 400 bad
  request) from a genuinely transient one (429 rate limit, 5xx). A live test with a
  deliberately-invalid API key showed a single 401 turning into up to 9 real API calls
  (3 internal retries × Inngest's own 2 function-level retries) and a much longer wait
  than necessary before the job correctly failed anyway. Fixed with `isPermanentError`
  (checks the Anthropic SDK's real `APIError.status`: retry only on 429/5xx/network
  errors, fail fast on everything else) — the kind of bug that's very easy to miss by
  only unit-testing the happy path and a generic "an error was thrown" case, and a
  concrete example of why this session prioritized exercising real behavior over
  trusting code that merely typechecked and looked correct.
- **`INNGEST_DEV=1` for local dev**: without it, the Inngest client defaults to "cloud
  mode" and complains about a missing signing key, even though `npx inngest-cli dev` is
  running locally with no keys needed. Found by actually starting the pipeline and
  reading the real startup warning, not by assuming the client "just works" once a
  local dev server is up.

## Deployment

See "Getting from here to deployed" above for the concrete steps. Target stack:
Vercel (app) + Neon (Postgres) + Inngest Cloud (background jobs) -- see
`docs/PLAN.md` §10 for the full environment variable list.
