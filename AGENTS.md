# AGENTS

Add shared agent instructions here.

<!-- BEGIN COMPOUND CODEX TOOL MAP -->
## Compound Codex Tool Mapping (Claude Compatibility)

This section maps Claude Code plugin tool references to Codex behavior.
Only this block is managed automatically.

Tool mapping:
- Read: use shell reads (cat/sed) or rg
- Write: create files via shell redirection or apply_patch
- Edit/MultiEdit: use apply_patch
- Bash: use shell_command
- Grep: use rg (fallback: grep)
- Glob: use rg --files or find
- LS: use ls via shell_command
- WebFetch/WebSearch: use curl or Context7 for library docs
- AskUserQuestion/Question: ask the user in chat
- Task/Subagent/Parallel: run sequentially in main thread; use multi_tool_use.parallel for tool calls
- TodoWrite/TodoRead: use file-based todos in todos/ with file-todos skill
- Skill: open the referenced SKILL.md and follow it
- ExitPlanMode: ignore
<!-- END COMPOUND CODEX TOOL MAP -->

--- project-doc ---

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

## Committing

- If I say "commit your changes" or "commit", commit only your session's changes and ignore everything else.
- Before committing, ensure no unrelated changes are staged (unstage anything you did not touch).
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
