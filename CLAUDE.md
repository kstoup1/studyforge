@AGENTS.md

# Delegation rules (Claude = planner/reviewer, Codex = worker)

Goal: spread work across the Claude and ChatGPT subscriptions and keep each session's context
small. Backlog lives in `BACKLOG.md`; `/next` runs one unit end to end.

## Roles

- **Claude**: plans, breaks work into small units, writes clear task specs, reviews diffs, runs
  tests, updates `BACKLOG.md`.
- **Delegate to Codex**: well-defined implementation tasks, boilerplate, tests, refactors,
  renames, bulk edits.
- **Keep for Claude**: architecture decisions, ambiguous requirements, debugging that needs
  reasoning across many files, final review.

## Every delegated task spec must include

1. **Goal** — one or two sentences on what "done" looks like.
2. **Files** — exact paths Codex may create/edit (nothing else).
3. **Constraints** — patterns to follow, things not to touch, no new deps, etc.
4. **Verify** — `npm run verify:fast` for Codex, plus any extra commands or behavior to check.

## How to delegate (shell; Codex has no MCP server mode in 0.160+)

Run from the repo root with the Bash tool, spec on stdin, only the final summary read back:

```bash
codex exec -s workspace-write --ephemeral -o "$TEMP/codex-last.md" - <<'SPEC' > "$TEMP/codex-log.txt" 2>&1; echo "exit $?"; cat "$TEMP/codex-last.md"
Goal: ...
Files: ...
Constraints: ...
Verify: ...
SPEC
```

- Use `run_in_background` (or a long timeout) for bigger units; only read `codex-log.txt`
  if the run failed.
- Don't pass `--dangerously-bypass-approvals-and-sandbox`.

## After Codex finishes

1. `git status` + `git diff` — reject edits outside the named files.
2. Run `npm run verify` myself (lint, format, types, tests, `build:webpack`; it prints one line
   per step and the tail of any failure), plus the spec's extra checks. Stop the dev server
   first — the build shares `.next/`; if it must keep running, use `npm run verify:fast`.
3. Pass → mark Done in `BACKLOG.md`. Fail → send Codex back specific fixes (max 2 rounds), then
   fix it myself or flag it to the user.

## Pace

Work one unit at a time. Never commit or push unless the user says so. When a unit is done,
tell the user it's ready for `/clear` and `/next`.
