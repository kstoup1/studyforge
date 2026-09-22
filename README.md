# StudyForge

An AI-powered spaced-repetition study tool. Upload or paste your lecture notes, get
back auto-generated flashcards, and study them with an SM-2 scheduler (the same
algorithm behind Anki) that tracks what you actually know and re-surfaces cards right
before you'd forget them.

Full architecture/design plan: see `docs/PLAN.md`. This README is both setup
instructions and a running log of the real engineering decisions behind the project —
written to double as interview prep, not just documentation.

## Status

Phase 0 (project foundation) in progress. See "What's built so far" below.

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
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, format check, Prisma generate,
  unit tests, build — on every push/PR.

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

## Deployment (planned)

Vercel (app) + Neon (Postgres) + Inngest Cloud (background jobs). See `docs/PLAN.md`
§10 for required environment variables.
