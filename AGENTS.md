<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working rules for the delegated worker (Codex)

These apply when you are executing a task spec handed to you by the planner (Claude Code).

- **Scope**: edit only the files the task names. If the job truly needs another file, stop and
  say which one and why instead of editing it.
- **Style**: match the surrounding code. TypeScript strict, Next.js App Router conventions,
  Prisma 7 driver-adapter client, Vitest for unit tests, Tailwind for UI, Prettier formatting
  (`.prettierrc.json`). No new dependencies unless the spec allows them.
- **Never**: commit, push, create branches, edit `.env*`, run migrations against a real DB, or
  delete files the spec doesn't mention.
- **Verify**: run `npm run verify:fast` (lint, formatting, types, unit tests) plus anything else
  the spec names, and report the result honestly, including failures. If a step dies with a
  sandbox error (e.g. `spawn EPERM`), say so rather than working around it -- the planner re-runs
  `npm run verify` outside the sandbox.
- **Finish with a short summary**: files changed (one line each), how you verified it, and
  anything left undone or uncertain.
