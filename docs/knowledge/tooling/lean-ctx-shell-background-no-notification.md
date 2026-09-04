# lean-ctx ctx_shell background tasks have no completion notification — rely on todo continuation to wake

## Context

ai-engkit uses lean-ctx's `ctx_shell(run_in_background=true)` for long-running shell tasks (release push, build, tests). In the OMO environment, `task()` background tasks (`bg_...`) push a `<system-reminder>` notification on completion, but lean-ctx background jobs (`shell_...`) never push any completion notification.

## Problem

Claiming "a completion notification will arrive after the background task finishes" is wrong. `ctx_shell(run_in_background=true)` returns a `shell_<hex>` job id and returns immediately; there is no notification mechanism when the task completes. An agent that waits for a notification stalls; a user who does not manually trigger the next turn leaves the task state untracked.

## Solution

1. **State the polling mechanism explicitly**: tell the user "this is a lean-ctx shell job, no completion notification will be pushed — I will check on the next turn".
2. **Keep the todo `in_progress`**: use OMO todo continuation as a passive wake-up channel — an incomplete todo triggers the system to wake into the next turn.
3. **Poll after waking**: `ctx_shell(background_action="status", job_id="shell_...")` returns the exit code and output (`[background:shell_... completed, exit 0]` or an evicted error).
4. After the poll reports completed, verify the final state with an independent command (release case: `git ls-remote --tags origin v1.18.2` confirms the remote ref really exists).

## Why It Works

A ctx_shell background job is a detached process (it lives until `timeout_ms`; after timeout or eviction it returns a structured error). Its state can only be queried actively, so the correct flow is "keep todo `in_progress` → get woken by todo continuation → poll actively with status". "Claiming you will be notified and waiting for the notification" violates this mechanism and causes stalls.

## Side Effects / Tradeoffs

- Background jobs have a `timeout_ms` cap (max 3600000 ms) and an eviction lifecycle; long tasks must be split or completed within the limit.
- `background_action="status"` can only query state; it cannot actively wake an agent on completion — an external wake source (todo continuation / user) is always required.
- Behavior differs from `task()` background tasks (`bg_...` get system notifications); do not mix the two waiting assumptions.

## Evidence

- v1.18.2 release (2026-09-05): the `ctx_shell(run_in_background=true)` push task `shell_130af480ea68813d` completed with no notification; todo 6 stayed `in_progress`, todo continuation woke the next turn, `background_action="status"` returned `completed, exit 0`, and `git ls-remote --tags origin v1.18.2` confirmed `refs/tags/v1.18.2` exists → the push was confirmed successful.

## Related Files

- `/home/devuser/workspace/ai-engkit/.opencode/skills/release/` (the skill that runs the push)
- `docs/CHANGELOG.md` (v1.18.2 section, df2c95b)
- Cross-reference: `docs/knowledge/tooling/run-tests-container-name.md` (another environment lesson from the same release round)

## Tags

- lean-ctx
- background-job
- orchestration
- omo
- release