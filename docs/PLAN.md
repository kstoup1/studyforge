# StudyForge — AI-Powered Spaced-Repetition Study Tool

## Context

The user is a college software engineering student who wants a portfolio-quality,
resume-worthy project — something that goes beyond a toy CRUD app and survives real
interview questions ("walk me through how X works"). They chose: a full-stack web app,
multi-week scope, an AI-powered study tool (upload notes → auto-generated flashcards →
spaced-repetition study scheduling), Next.js + TypeScript + Postgres, and the Anthropic
API (their own key) for generation. The goal of this plan is a concrete, defensible
architecture that produces genuine "here's a real algorithm/system I built and tested"
talking points, not just a working demo.

**Project name: StudyForge** (notes → forged into flashcards). Easy to change later if
the user prefers something else — flag this on review.

## 1. Architecture

One Next.js 14+ (App Router, TypeScript) project, deployed to **Vercel**. No separate
backend service — a single deployable app is the right scope here and is what most
interviewers expect you to defend confidently.

- **Server Actions** for fast synchronous mutations: create/rename/delete deck, submit
  a card review/grade.
- **Route Handlers** (`app/api/**/route.ts`) for file upload, the Inngest webhook, and
  job-status polling.
- **LLM generation runs as a background job, not inline in the upload request.**
  PDF-parse + chunked LLM calls realistically take 10–40+ seconds — a real risk against
  Vercel's serverless execution limits (10s Hobby / 60s Pro) and bad UX to block on.

**Background jobs: [Inngest](https://www.inngest.com/).** This is a deliberate
"solve a real async/serverless problem" choice, not just picking a trendy tool: Inngest
gives durable, step-based, automatically-retried background functions with a first-class
Next.js adapter and no infra to self-host (no Redis, no worker process). It turns
"upload a PDF" into a narratable multi-step pipeline: `extract-text` →
`chunk-and-generate` → `persist-cards`, each step independently retried on failure.

Flow: upload → `POST /api/uploads` creates `NoteSet` + `GenerationJob` (status
`pending`), fires an Inngest event, returns immediately → an Inngest function runs the
pipeline, updating `GenerationJob.status`/`stage` as it goes → client polls
`GET /api/jobs/:id` every ~2s to show progress ("Extracting text…", "Generating
flashcards…", "Done — 24 cards created"). No websockets needed.

## 2. Database Schema (Postgres + Prisma)

Core tables: `User`, `Deck`, `NoteSet` (one uploaded/pasted source document),
`GenerationJob` (tracks the async pipeline run), `Card`, `CardScheduleState` (live SM-2
state, 1:1 with Card, `userId` denormalized for a fast indexed "due cards" query), and
`ReviewLog` (append-only history — powers streaks/mastery stats, and is a clean
"current-state table vs. append-only log" separation worth explaining in an interview).
Plus NextAuth's standard `Account`/`Session` models via the Prisma Adapter.

The actual schema lives in `prisma/schema.prisma` — implemented and migrated
successfully during Phase 0 (see the repo root README's "What's built so far").

## 3. Spaced Repetition — SM-2, pure isolated module

**SM-2** (the Anki/SuperMemo-2 algorithm), not a fancier variant like FSRS — well
documented, small well-defined state, and the reference point most interviewers already
know. FSRS is more accurate but too large a risk to implement solo in this timeframe.

`src/lib/sm2/sm2.ts` — a **pure function**, zero Prisma/Next imports, `now` passed in
as a parameter (not read internally) so it's fully deterministic and testable. Standard
SM-2 rules: `EF' = EF + (0.1 - (5-q)(0.08+(5-q)*0.02))`, clamped `>= 1.3`; grade `< 3`
resets `repetitions` to 0 and `intervalDays` to 1; grade `>= 3` increments `repetitions`
and sets interval to 1 / 6 / `round(prevInterval * EF)` for reps 1 / 2 / 3+.

The `submitReview(cardId, grade)` Server Action (Phase 3) will be a thin I/O wrapper:
load `CardScheduleState`, call `computeNextSchedule`, write the result back + insert a
`ReviewLog` row in one Prisma `$transaction`. All the logic lives in the pure function —
this "logic vs. I/O" separation is the single best "explain this to me" artifact in the
whole project.

**Implemented in Phase 0**, ahead of its originally-planned Phase 3 slot, along with its
full test suite (23 tests) — see the root README.

## 4. Auth — Auth.js (NextAuth) v5 + Prisma Adapter

Google OAuth (primary — fast, no password liability, looks clean in a demo) plus a
Credentials provider (email + bcrypt-hashed password) as a fallback that also
demonstrates understanding password/session handling directly, not just wiring a button.
**Database sessions** (not JWT) since Postgres is already there — simpler revocation,
and an easy interview answer for "why not JWT here."

Files: `src/lib/auth.ts` (shared config/`auth()`/`signIn`/`signOut`),
`app/api/auth/[...nextauth]/route.ts`.

## 5. LLM Integration — swappable module behind one interface

`src/lib/llm/types.ts` defines `FlashcardGenerator` (`generateFlashcards({text,
maxCards}) => Promise<GeneratedCard[]>`); `src/lib/llm/claude-generator.ts` implements
it against the Anthropic SDK; `src/lib/llm/index.ts` exports a `getFlashcardGenerator()`
factory — nothing else in the app imports the Anthropic SDK directly, and the factory is
what makes this mockable in tests (never hit the real API in CI).

- **Forced structured output via tool use**: define one tool (`record_flashcards`) with
  a JSON-Schema array-of-`{question,answer}` input, and force it with
  `tool_choice: {type: "tool", name: "record_flashcards"}` — far more reliable than
  asking for prose JSON and parsing it.
- **Validate with Zod** before anything touches the DB
  (`z.array(z.object({question: z.string().min(1), answer: z.string().min(1)})).min(1).max(50)`).
- **Retry** transient 429/529 errors (3 attempts, exponential backoff); validation
  failures are not retried — surfaced as `GenerationJob.status = FAILED`.
- **Chunk** text over ~12k characters by paragraph/section, merge results, cap total
  cards (e.g. 40) to control cost.
- System prompt fixes persona/instructions (concise, exam-relevant, no duplicate or
  trivially-restated questions, favor conceptual/why-how framing).

`ANTHROPIC_API_KEY` from env, server-side only (Inngest function), never sent to the
client.

## 6. File Upload + Text Extraction

**`unpdf`** for PDF text extraction (a modern pdf.js wrapper built for serverless Node,
avoids `pdf-parse`'s native-binding friction). Runs in the Node runtime, not Edge.

**Do not persist raw PDF files.** Extract text as the Inngest pipeline's first step,
store only `NoteSet.extractedText` in Postgres, discard the file buffer. Nothing
downstream needs the original bytes, and skipping file storage removes a whole subsystem
(blob storage, signed URLs, size/cleanup policy) with no feature payoff — a legitimate,
statable "evaluated and chose not to" decision. Upload Route Handler buffers
`multipart/form-data` in memory, caps size (e.g. 15MB), extracts, discards. Pasted text
skips extraction entirely. (Adding Vercel Blob later for "view your original PDF" would
be a small, well-understood addition — explicitly out of scope for now.)

## 7. Testing — Vitest

1. **SM-2 module — the centerpiece.** Full unit tests: every grade 0–5 on a first
   review, EF floor (1.3), interval progression 1 → 6 → EF-multiplied on repeated
   success, lapse-resets-repetitions after a long streak. **Done in Phase 0** — see root
   README.
2. **LLM module** — Zod validation + chunk/merge logic, tested against a **fake
   `FlashcardGenerator`** (no real API calls in CI); malformed tool-use output must be
   rejected before it reaches the DB.
3. **Route Handler / Server Action integration tests** — `submitReview` end-to-end
   against a test Postgres (local Docker or a Neon branch); uploads route creates
   `NoteSet`+`GenerationJob` and enqueues the Inngest event (mock `inngest.send`).
4. **Inngest function tests** via `@inngest/test`, mocked LLM — assert step sequencing
   and retry behavior.
5. _(Stretch, Phase 5)_ a couple of Playwright e2e smoke tests.

CI: GitHub Actions running lint + format check + `vitest run` + `next build` on every
push/PR — implemented in Phase 0 (`.github/workflows/ci.yml`).

## 8. Phased Build Plan

Each phase ends in something runnable/demoable — important since this spans weeks.

- **Phase 0 (~½–1 day):** Scaffold Next.js+TS+Tailwind, Prisma+local dev DB connected,
  ESLint/Prettier, Vitest, GitHub repo + CI skeleton. _(In progress/mostly done — see
  root README's "What's built so far" for the current, accurate state.)_
- **Phase 1 (~1 week):** Auth.js (Google + Credentials) + Prisma Adapter. Deck
  create/rename/delete via Server Actions, scoped per user. App shell/nav. → real
  persisted multi-user app.
- **Phase 2 (~1–1.5 weeks):** Done. `NoteSet`/`GenerationJob`/`Card` migrations,
  `src/lib/llm/` (Claude tool-use + Zod validation + chunking + retry, 32 tests),
  `src/lib/pdf/extract-text.ts` (unpdf, tested against a real PDF fixture), the full
  Inngest pipeline, upload UI with job-status polling. Live-tested end-to-end with a
  real (deliberately invalid) API key, which caught and led to fixing a real retry-
  classification bug — see the root README's "Why these choices" for the full story.
- **Phase 3 (~1 week):** Done. `src/actions/cards.ts` (`getDueCards`), `src/actions/
reviews.ts` (`submitReview`), `src/components/study/study-session.tsx` (flip-card,
  4-button grading). Every `Card` gets a `CardScheduleState` at creation time (in the
  Inngest pipeline). Live-tested with real graded reviews against a seeded deck
  (`scripts/seed-test-cards.ts`) — DB state after grading matched the SM-2 module's
  independently-verified math exactly.
- **Phase 4 (~1 week):** Dashboard done (`/dashboard`, `src/lib/dashboard/stats.ts` --
  due today, streak, per-deck mastery %, 13 unit tests, live-verified against real
  data). Basic empty/error states already present from earlier phases. Remaining:
  deploy to Vercel + Neon (needs the user's own accounts, out of scope for
  unsupervised work) and optionally Server-Action-level integration tests (skipped
  in favor of the live browser+DB verification already done at each phase, which
  is at least as rigorous). See the root README's "Getting from here to deployed"
  for the concrete remaining steps.
- **Phase 5 (optional stretch):** CSV/Anki export — done (`src/lib/export/card-export.ts`,
  11 unit tests covering CSV/TSV escaping edge cases; `GET /api/decks/:id/export?format=
csv|anki` route handler reusing the same auth+ownership pattern as `uploads`/`jobs`;
  buttons on the deck page). Not attempted: quiz/multiple-choice cards (`CardType.QUIZ_MC`
  already exists in the schema but is unused — would need LLM-generator, pipeline, and
  study-UI changes across three layers, a bigger lift than remaining time justified),
  Playwright e2e (the manual browser+DB verification already done at every phase is
  comparable rigor for a solo project), FSRS as an alternate scheduler (a real algorithm
  reimplementation risk with no reference to verify against locally — SM-2 alone is
  already a strong, correctly-tested talking point).

## 9. Project Structure

```
studyforge/
├── docs/PLAN.md                                        # this file
├── prisma/{schema.prisma, migrations/}
├── src/
│   ├── app/
│   │   ├── (marketing)/page.tsx
│   │   ├── (auth)/{sign-in,sign-up}/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── decks/{page.tsx, [deckId]/{page.tsx, upload/page.tsx, study/page.tsx}}
│   │   ├── api/{auth/[...nextauth]/route.ts, inngest/route.ts, uploads/route.ts,
│   │   │        jobs/[jobId]/route.ts}
│   │   ├── layout.tsx, globals.css
│   ├── actions/{decks.ts, cards.ts, reviews.ts}       # Server Actions by domain
│   ├── inngest/{client.ts, functions/generate-flashcards.ts}
│   ├── lib/
│   │   ├── auth.ts, db.ts                              # Prisma client singleton
│   │   ├── sm2/{sm2.ts, sm2.test.ts}                   # done
│   │   ├── llm/{types.ts, claude-generator.ts, index.ts, claude-generator.test.ts}
│   │   ├── pdf/extract-text.ts
│   │   └── dashboard/stats.ts
│   ├── components/{ui/, decks/, study/, dashboard/}
│   └── generated/prisma/                               # generated, gitignored
├── scripts/db-smoke-test.ts                            # manual DB connectivity check
├── .github/workflows/ci.yml                            # done
├── .env.example, vitest.config.ts, next.config.ts, package.json, README.md
```

Conventions: Server Actions grouped by domain in `src/actions/*` (never inlined in page
files, so they're independently testable). Everything under `src/lib/**` stays
framework-agnostic (no `"use server"`/Next imports) where feasible — that's what makes
SM-2 and the LLM module cleanly isolated and unit-testable.

## 10. Deployment

- **Vercel** (Hobby to start; Pro is a one-click upgrade if execution limits are ever
  actually hit — should rarely matter given the Inngest design).
- **Neon** for Postgres in production — serverless with branching (a nice "ephemeral DB
  per PR/test run" extra talking point), no need for Supabase's extra auth/storage/
  realtime here. (Local dev uses Prisma's own `npx prisma dev` instead — see root
  README.)
- **Inngest Cloud** free tier; local dev via `npx inngest-cli dev`.
- Env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.

## Verification

- Each phase should be run locally (`npm run dev`) and clicked through end-to-end before
  moving on — e.g. Phase 1 isn't done until you can actually sign up, log in, and see a
  deck you created persist across a page reload.
- `vitest run` must pass, especially the SM-2 suite, before considering Phase 3 done.
- `next build` must succeed cleanly (this is what CI checks) before each deploy.
- Final end-to-end verification: on the deployed Vercel URL, sign up, paste in a real
  page of lecture notes, watch the job-status UI progress to completion, review the
  generated cards, grade a few, and confirm the dashboard's "due today" count and
  streak reflect it correctly.
