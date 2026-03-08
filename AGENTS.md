# Agent Guide

## Issue Tracking

This project uses **bd (beads)** for issue tracking. Run `bd onboard` to get started. For workflow context, run `bd prime`.

**Quick reference:**

- `bd ready` - Find unblocked work
- `bd show <id>` - View issue details
- `bd update <id> --status in_progress` - Claim work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

## Coding guardrails

- Favor type inference; avoid `any` and unnecessary casts.
- Disabling lint rules is usually a sign that you should reconsider your approach.
- When you see unrelated unstaged/uncommitted files, ignore them. Do not touch, stage, or revert them.
- You do not need to mention unrelated uncommitted files in your responses.

## Browser Bridge Worktree Runtime (Mandatory)

For Browser Bridge tasks, run this flow in the active worktree:

1. Run `browser-bridge dev info` first to get resolved host/port/worktree/log paths.
2. Run `browser-bridge dev activate` for extension-driving tasks.
   - Use `--extension-id <id>` when needed.
3. Check `.context/logs/browser-bridge/` before ad-hoc debugging.
   - Inspect per-stream JSONL files (`cli.jsonl`, `core.jsonl`, `mcp-adapter.jsonl`) first.

## Working from specs

- When executing a spec, the moment you finish a step in that spec, mark it with a green check mark emoji (✅) and add any relevant implementation notes right beside the step.
- If you can not find skills definitions, look under `~/.agents/skills`.

## Beads usage

- Use beads for multi-session work, major features, or when decisions need to survive compaction.
- Prefer an epic with milestone tasks for sequential work; keep bead count low.
- When creating an epic with associated tasks, use `--parent <epic-id>` to make tasks hierarchical children of the epic. Do not create separate issues with custom dependencies via `bd dep add`.
- Store full specs/plans in the repo under `docs/` and link the path in the epic's design field (and optionally in milestones).
- Update beads if scope, decisions, or acceptance criteria change.
- Beads sync branch is managed via a git worktree (e.g., `beads-sync`); do not commit `.beads` changes on feature branches or delete the sync worktree.

## Bug Fix Registry

- Maintain a local TOC at `docs/bug-fix-registry.md` for bug-fix history. Keep entries short: bug label, one-line fix summary, and PR link.
- Put detailed root cause + fix notes in the PR description, not in the registry.
- When fixing a bug, update the registry in the same session.
- If a previous entry matches the same symptom, read that PR first and avoid repeating the same failed fix path.

## Committing

- If I say "commit your changes" or "commit", commit only your session's changes and ignore everything else.
- Before committing, ensure no unrelated changes are staged (unstage anything you did not touch).
- Any time you implement a new feature or fix a bug, add an entry to `CHANGELOG.md` under `[Unreleased]`.
- If I tell you to commit and push, I mean: commit to local `main`, then push `main` to `origin/main`.
- If I tell you to "ship it", I mean: commit to local `main`, then push `main` to `origin/main`.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Output hygiene

- Stick to ASCII punctuation (use "-" and "'"); avoid curly quotes/dashes unless required in proper names.
- Only emit citation markers when using real `web.run` sources; otherwise omit them.
- Skim rendered output for stray replacement boxes before handing off.
