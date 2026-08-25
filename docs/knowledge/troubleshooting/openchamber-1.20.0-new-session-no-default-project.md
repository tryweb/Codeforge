# OpenChamber 1.20.0 — New Session No Longer Pre-selects the Default Project

## Context

The ai-engkit environment exposes the OpenChamber Web UI (port 3000 per the
DooD network notes in `AGENTS.md`). After OpenChamber upgraded to
v1.20.0 (released 2026-08-22), clicking **New session** in the top-left no
longer carries a default/last-used project into the draft; the composer shows
a bare **Choose project** dropdown instead.

## Problem

Users assumed a local misconfiguration (wiped project list, lost default
setting). Symptom: every new session draft starts project-less, and a prompt
typed before picking a project creates a plain **Chat** session instead of a
project session — the work then lands outside any project context.

Local state was verified healthy: `openchamber projects.list` returned all 4
configured projects (`marktext`, `ai-engkit`, `$HOME`, `openchamber`), so the
project registry was intact. The behavior change is upstream.

## Solution

Treat it as the known upstream regression and apply the interim workaround:

- Upstream issue: [openchamber/openchamber#3089](https://github.com/openchamber/openchamber/issues/3089)
  — "[Bug] No project selected on app start anymore", filed 2026-08-23.
  Maintainer labels: `bug`, `regression`, `reproducible:true`,
  `priority:medium`, `area:sessions`, `platform:web`.
- Fix in progress: [PR #3110](https://github.com/openchamber/openchamber/pull/3110)
  — "fix(sync): restore persisted project for targetless drafts" in
  `packages/ui/src/sync/session-ui-store.ts`. Open, unmerged as of
  2026-08-25 (awaiting code-owner review; Greptile flagged a P1 edge case:
  unmatched live directory + valid persisted project resolves incorrectly).
- Workaround until the fix ships: manually pick the project in
  **Choose project** before sending the first message in a new session.

## Why It Works

The v1.20.0 changelog states: "Settings: the project selector on Providers,
Agents, MCP, Commands and Skills now only changes what those pages show. It
used to switch the whole app." Decoupling the settings project selector from
the app-wide active project changed targetless-draft resolution: with no live
current directory, the draft no longer falls back to the persisted project
and instead opens project-less ("Choose project" / Chat).

## Side Effects / Tradeoffs

- Until the fix lands in a release, every New session requires a manual
  project pick; forgetting it silently creates a Chat session.
- PR #3110's open review comment means the eventual fix may behave slightly
  differently than the pre-1.20.0 behavior — re-verify against the release
  notes when it ships.
- Status is time-sensitive: check issue #3089 state before re-diagnosing
  this symptom on a newer version.

## Evidence

- Issue #3089 labels and body (symptom matches exactly; reporter on Desktop
  Web v1.20.0 + OpenCode v1.18.21).
- PR #3110 status: Open, 1 commit, review requested from code owner
  `btriapitsyn` on 2026-08-24; Greptile confidence 4/5 with one P1 comment.
- v1.20.0 release notes (2026-08-23) — project-selector decoupling entry.
- Local check this session: `openchamber` MCP `projects.list` → 4 projects
  present, ruling out local config loss.

## Related Files

- External only — no files in this repo are involved.
- `AGENTS.md` (DooD network awareness) documents the OpenChamber Web UI at
  port 3000 in this environment.
- Upstream: `packages/ui/src/sync/session-ui-store.ts` (fix location).

## Tags

openchamber, ui, regression, sessions, upstream-issue, known-issue, 1.20.0
