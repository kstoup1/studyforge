# StudyForge

An AI-powered spaced-repetition study tool. Upload or paste your lecture notes, get
back auto-generated flashcards, and study them with an SM-2 scheduler (the same
algorithm behind Anki) that tracks what you actually know and re-surfaces cards right
before you'd forget them.

Full architecture/design plan: see `docs/PLAN.md`. This README is both setup
instructions and a running log of the real engineering decisions behind the project —
written to double as interview prep, not just documentation.

## Status

Phase 0 (project foundation), Phase 1 (auth + deck management), and Phase 2 (upload →
AI generation pipeline) done and live-tested end-to-end. Phase 3 (SM-2 study session
UI) next. See "What's built so far" below.

## Stack

- **Next.js 16** (App Router, TypeScript) — Server Actions for mutations, Route
  Handlers for uploads/webhooks/polling.
- **Postgres via Prisma 7**, using the new driver-adapter pattern (`@prisma/adapter-pg`)
  — no `DATABASE_URL` in the schema file anymore; the adapter is constructed explicitly
  in `src/lib/db.ts`.
- **Anthropic API (Claude)** for flashcard generation, behind a swappable interface
  (`src/lib/llm/`) so the provider isn't hard-wired into the rest of the app.
- **Inngest** for background job processing (note extraction + generation runs as a
  durable, retryable, step-based pipeline instead of blocking a request — see "Why
  these choices" below).
- **Auth.js (NextAuth) v5** with the Prisma Adapter — Google OAuth + email/password.
- **Vitest** for tests.

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

## Deployment (planned)

Vercel (app) + Neon (Postgres) + Inngest Cloud (background jobs). See `docs/PLAN.md`
§10 for required environment variables.
