# Permissions Management Plan: Human-Controlled CLI/MCP Access

## Problem

Browser Bridge already has a decent soft-permissions model in the extension UI:

- per-site allowlist
- granular vs bypass mode
- one-time vs always-allow prompt flow

But the control surface is extension-only. That creates two problems:

1. Humans cannot inspect or manage permissions from CLI/MCP-driven workflows.
2. A naive writable CLI or MCP tool would let the agent silently grant itself more access, which would be a terrible own-goal.

## Goals

1. Let humans inspect current Browser Bridge permission state from CLI and MCP.
2. Let humans ask the agent to initiate permission changes without giving the agent unilateral authority.
3. Keep the extension as the single source of truth for allowlist and mode state.
4. Preserve the current safe-by-default story: no silent self-escalation, no hidden bypass flips.

## Non-Goals

- Redesigning the existing site-permission prompt UX for drive actions.
- Changing restricted-URL rules.
- Building a general-purpose policy engine.
- Supporting silent permission writes from any agent-accessible interface.

## Design Decisions

1. Extension storage remains the source of truth. CLI, Core, and MCP should read/write permission state only through shared extension-backed APIs.

2. Reads are cheap; writes require human confirmation. Listing approved sites, checking current mode, and showing pending requests can be machine-readable. Any allow/revoke/mode-change mutation must require an explicit human approval step in the browser.

3. "Request change" is the writable primitive, not "change immediately." Agent-accessible surfaces may request a permission change, but the extension should only apply it after a human approves the request.

4. Bypass mode gets extra friction. Requesting `bypass` should require a more explicit warning/confirmation than adding a single site.

5. CLI and MCP stay thin. Shared contracts plus Core routes should define the semantics. CLI and MCP should forward those contracts rather than invent adapter-specific behavior.

## Proposed UX

### Read operations

- `browser-bridge permissions list`
- `browser-bridge permissions mode`
- MCP tools for:
  - listing allowlisted sites
  - reading current permissions mode
  - listing pending permission-change requests

### Mutation flow

1. CLI or MCP sends a permission-change request to Core.
2. Core forwards the request to the extension.
3. Extension opens a dedicated approval UI for the human.
4. Human approves or denies.
5. Extension persists the change if approved.
6. CLI/MCP receives final status or a pending/timeout result.

### Example mutation verbs

- `browser-bridge permissions allow --site example.com`
- `browser-bridge permissions revoke --site example.com`
- `browser-bridge permissions set-mode --mode granular`
- `browser-bridge permissions set-mode --mode bypass`

The same operations may exist in MCP only if they are modeled as approval-gated requests rather than direct writes.

## Architecture

### Shared contract

Add shared request/response schemas for:

- `permissions.list`
- `permissions.get_mode`
- `permissions.request_allow_site`
- `permissions.request_revoke_site`
- `permissions.request_set_mode`
- `permissions.list_pending_requests`

Responses for request-style mutations should include:

- request id
- requested action
- target site or mode
- status: `pending`, `approved`, `denied`, `timed_out`
- any warning text for dangerous actions such as bypass mode

### Core

- Add `/permissions/*` routes.
- Forward permission requests to the extension over the existing bridge.
- Do not persist permission state in Core.
- Normalize timeout and denial errors so CLI and MCP behave identically.

### Extension

- Add a new approval flow for external permission-change requests.
- Reuse existing site-permissions storage helpers.
- Reuse as much of the current prompt/options presentation as practical, but keep the copy explicit that this request came from CLI/MCP and still needs human approval.
- Ensure direct writes remain impossible without that approval step.

### CLI

- Add a `permissions` command group.
- Support human-readable and JSON output for reads.
- For writes, print pending status clearly and tell the user approval is required in Chrome.

### MCP

- Add read tools.
- Add approval-gated request tools only if their descriptions make the human-confirmation requirement explicit.
- Do not expose any tool that directly mutates allowlist or mode without approval.

## Scope

### In scope

- Shared contracts for permission reads and approval-gated requests
- Core routes and forwarding
- Extension approval UI for external permission changes
- CLI `permissions` command group
- MCP tools for reads and approval-gated requests
- Docs and manual test coverage

### Out of scope

- Bulk import/export of site permissions
- Role-based permission policies
- Persisting historical audit logs beyond request status needed for UX/debugging

## Milestones

### Milestone A - Shared contracts and Core plumbing

- Define shared schemas and error shapes for permission reads and request-based mutations.
- Add Core `/permissions/*` routes with parity semantics for CLI and MCP.
- Add tests proving no direct-write route exists.

### Milestone B - Extension approval flow

- Implement extension-side handling for external permission-change requests.
- Add approval UI with stronger warning copy for bypass mode.
- Persist changes only after explicit approval.

### Milestone C - CLI and MCP surfaces

- Add CLI `permissions` commands for read operations and approval-gated requests.
- Add MCP tools for read operations and approval-gated requests.
- Ensure tool/command docs make the human approval requirement impossible to miss.

### Milestone D - Docs and regression coverage

- Update README and skill docs.
- Add manual-test steps covering allow, revoke, granular, bypass, denial, and timeout flows.
- Add contract tests that keep CLI and MCP behavior aligned.

## Acceptance Criteria

- Humans can inspect allowlist and mode from CLI and MCP.
- An agent cannot silently grant itself site access or enable bypass mode.
- Any permission mutation initiated from CLI or MCP requires explicit human approval in the browser before storage changes.
- CLI and MCP use shared contracts and return aligned status/error semantics.
- Docs explain the difference between immediate drive-action prompts and approval-gated external permission-change requests.

## Open Questions

1. Should request approval happen in a dedicated popup, the options page, or both?
2. Should request tools block waiting for approval, or return a `pending` result and require polling?
3. Should bypass-mode approval require a second confirmation click or a typed confirmation?
