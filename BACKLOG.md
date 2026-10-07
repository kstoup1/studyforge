# Backlog

Top of **Todo** = next up. Each item has an acceptance check. `/next` takes the top Todo item.

## Todo

1. **Task spec template** — `templates/task.md` with Goal, Files, Constraints, Verify, Out of scope;
   CLAUDE.md says to fill it in before delegating.
   _Accept:_ template exists; CLAUDE.md delegation section references it.
2. **/handoff skill** — at about 50% context, save progress to BACKLOG.md + `SESSION.md` and print a
   continuation prompt to copy.
   _Accept:_ skill file exists and a dry run writes SESSION.md and prints the prompt.
3. **Git safety net** — each unit runs on its own `task/<name>` branch; Claude reviews
   `git diff master`, then merges or discards. Update CLAUDE.md and the /next skill.
   _Accept:_ documented flow; one unit run end to end on a task branch.
4. **Project map** — `docs/MAP.md`: one line per folder or key file; /next updates it when files are
   added; agents read it before exploring.
   _Accept:_ MAP.md covers every top-level folder and `src/` subfolder; CLAUDE.md/AGENTS.md reference it.
5. **Decision log** — `docs/DECISIONS.md`, one line per settled decision with its reason (seed it
   with existing ones: Prisma 7 driver adapter, Canvas personal tokens not OAuth, no stored files,
   dependency-free PPTX ZIP reader, Ollama/Anthropic providers…). CLAUDE.md/AGENTS.md: read it, don't
   re-argue it; /next appends new decisions.
   _Accept:_ file seeded with at least 8 real decisions; both agent files reference it.
6. **Summarizing log wrapper** — `npm run verify` already shows only a failing step's last 40
   lines (ANSI stripped, lines capped at 300 chars). Still to do: a general `scripts/quiet.mjs <cmd>`
   for one-off runs (single test files, e2e) that pulls out the failure blocks (Vitest/Playwright/tsc)
   instead of a blind tail, and that verify can reuse.
   _Accept:_ a passing run prints one or two lines; a forced failing test prints the failure with
   about 20 lines of context, not the full log; the exit code is passed through.
7. **Claude Code hooks** — PostToolUse: Prettier on edited files; PreToolUse: block edits to `.env*`
   and secret files. Goes in project `.claude/settings.json`.
   _Accept:_ editing a .ts file auto-formats it; an attempted `.env` edit is blocked with a message.
8. **/review skill** — checks Codex's diff against the task spec and the verify output, then answers
   approve, a fix list, or reject. /next calls it in its Verify step.
   _Accept:_ skill file exists; used on one real unit.
9. **Usage tracker** — SESSION.md records, per task, which agent did it and roughly how heavy it was
   (S/M/L), so work can shift to whichever subscription has room. /next and /handoff append to it.
   _Accept:_ format documented; entries appear after a /next run.
10. **Project starter template** — a folder with CLAUDE.md, AGENTS.md, BACKLOG.md, the verify script,
    the quiet wrapper, MAP.md, DECISIONS.md, the task template and hooks, ready for new projects (bar
    deals app, campus nav…). Do this last, once the items above have settled. Ask the user where
    it should live.
    _Accept:_ copying it into an empty folder gives a working `/next` loop.
11. **Parallel workers with git worktrees** — Codex runs task A in one worktree (`git worktree add
   ../studyforge-<task> task/<name>`) while Claude handles task B in another; each verifies in its
    own tree, and Claude reviews and merges both. Needs items 1, 4 and 9 (verify, task branches,
    /review) working reliably first. Watch out for shared state: separate `.next/` per tree, one dev
    server and DB port at a time, and `npm install` in each worktree.
    _Accept:_ two units finish in parallel worktrees, both pass verify and /review, and both merge
    cleanly into master.
12. **Run the mock-Canvas e2e** for the PPTX import (DB + Inngest + both mocks + dev server).
    _Accept:_ `e2e/canvas.spec.ts` passes.
13. **Exam-date-aware study priority** — a deck can have an exam date; due cards from decks with
    nearer exams sort first.
    _Accept:_ Prisma field + migration; unit tests for the ordering; dashboard shows the exam date.
14. **Canvas: auto-sync new files** — re-import only files not already imported for a deck.
    _Accept:_ importing twice doesn't duplicate cards (unit test on the dedupe logic); e2e with mock Canvas.
15. **Try import against real Auburn Canvas** (needs the user's token) — run the import against
    auburn.instructure.com.
    _Accept:_ one real course imports without errors; any bugs found are added here.
16. **Deploy prep (Vercel + Neon)** — env var list, hosted LLM provider choice, build settings.
    _Accept:_ `docs/DEPLOY.md` with exact steps; `npm run build:webpack` passes with prod-like env.
17. **Fix CI branch trigger** — `.github/workflows/ci.yml` triggers on `main`, but the repo's branch is
    `master`, so CI never runs. Also consider running `npm run verify` there instead of separate steps.
    _Accept:_ CI triggers on push/PR to master; the workflow is valid YAML.

## In Progress

## Done

- **Canvas: import PPTX files** — Codex. Dependency-free ZIP reader with zip-bomb caps (`src/lib/pptx/`),
  wired into the Canvas import; mock Canvas serves a real .pptx. Verified: `npm test` (145), tsc, lint,
  prettier, mock .pptx run through the extractor. Full e2e not run (needs DB/Inngest/servers).
- **Verify script** — Claude. `npm run verify` / `verify:fast` (`scripts/verify.mjs`): lint, format, tsc,
  vitest, build:webpack, one line per step, and the tail of a failure. CLAUDE.md, AGENTS.md and the /next
  skill point to it. Verified: clean run exits 0; a deliberate type error exits 1 and names only `types`.
  Also fixed Prettier failures in 3 markdown files. A stale `.next/` caused a webpack WasmHash crash and
  was cleared.
