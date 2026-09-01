# Agent Model History Scan Policy

## Context

The Admin Agent Models view uses retained OpenCode request metadata as historical evidence, while the `/agent` endpoint remains authoritative for the current assignment.

## Problem

OpenCode sessions are scoped by project directory, and a history sweep can become expensive when a workspace contains many projects or sessions.

## Solution

The history collector queries the live managed OpenCode `/api/session` endpoint across the workspace root and registered project paths. It excludes project directories whose basename is listed in `disabled-projects.json`; a missing or malformed disabled-projects file safely excludes nothing. The sweep is bounded to 64 directories, 50 pages per directory, 800 sessions, 20 message attempts per agent, and 60 seconds. If a bound or command failure is reached, the result carries `truncated: true` and a warning instead of silently presenting an empty history.

Decorated runtime agent names are canonicalized only when the current `/agent` response verifies that exact display name. The configured model and current assignment remain separate from historical request evidence.

## Why It Works

Disabled projects remain on disk for explicit re-enable, but their old sessions do not influence active Admin model status. Bounded collection prevents a large workspace from blocking the Admin endpoint, while metadata makes incomplete history visible to callers.

## Side Effects / Tradeoffs

- A newly re-enabled project contributes history on the next collection.
- A truncated collection may leave an agent in `awaiting_request`; callers should inspect the warning before treating missing history as definitive.
- The collector cleans only its temporary files and never removes workspace directories.

## Evidence

- `src/admin/lib/agent-model-history.ts` implements directory, page, session, per-agent, and deadline bounds.
- `src/admin/lib/agent-model-history.test.ts` covers object-shaped output, timestamp normalization, visible truncation, cleanup guards, and disabled-project filtering contract.

## Related Files

- `src/admin/lib/agent-model-history.ts`
- `src/admin/lib/agent-models.ts`
- `src/admin/lib/openchamber-projects.ts`
- `src/admin/static/projects-page.js`

## Tags

- agent-models
- openchamber
- disabled-projects
- session-history
- bounded-scan
