# `.opencode/AGENTS.md.default` edits never reach sessions (sentinel-append deadlock)

## Context

ai-engkit ships agent-facing environment guidance as a template:
repo `.opencode/AGENTS.md.default` → `Dockerfile:262`
(`COPY .opencode/AGENTS.md.default /etc/opencode/AGENTS.md.default`) →
container startup script `entrypoint.d/02-init-config.sh` (repo mirror of
`/entrypoint.d/02-init-config.sh`) appends it to the user-level
`~/.config/opencode/AGENTS.md`, which is what OpenCode actually injects into
sessions. The repo-root `AGENTS.md` is a separate minimal pointer file and is
never derived from the template.

## Problem

The entrypoint's idempotency check tests only for the opening sentinel:

```bash
if ! grep -q '<!-- @ai-engkit -->' "$USER_AGENTS_MD"; then
  cat "$AI_ENGKIT_AGENTS_DEFAULT" >> "$USER_AGENTS_MD"
fi
```

Any user-level `AGENTS.md` that already contains an older `@ai-engkit` block
satisfies the check, so **updated defaults are never appended — on any number
of container restarts or image rebuilds**. Observed 2024-08-24: the image
(rebuilt that morning) contained the new
`### When lean-ctx Triage Hides Diagnostic Output` section in
`/etc/opencode/AGENTS.md.default` (verified `grep -c 'Triage Hides'` = 1), yet
the live `~/.config/opencode/AGENTS.md` still lacked it, along with
`Environment Verification` and `Executing Shell Commands`, and kept a stale
duplicate of `Defensive jq Usage` at a different position. Sessions therefore
never saw guidance that had been "documented".

## Solution

Two-part (part 1 implemented 2026-08-24 in `entrypoint.d/02-init-config.sh` —
`sync_ai_engkit_agents_md` hash-compares and replaces the block in place;
effective from the next image rebuild):

1. Make the merge content-aware in `entrypoint.d/02-init-config.sh`: compare a
   hash of the default against the block between the `<!-- @ai-engkit -->` …
   `<!-- /@ai-engkit -->` sentinels in the user file and replace-in-place on
   mismatch (or stamp a version into the opening sentinel and match exactly).
2. One-time manual unblock without waiting for the script fix: delete the stale
   `@ai-engkit` block from `~/.config/opencode/AGENTS.md` and let the next
   container start re-append the current default — or paste the corrected
   sections directly into the user file.

## Why It Works

The sentinel was designed so the append happens "exactly once, surviving
container restarts". That is precisely what turns any later template update
into a no-op: existence-check semantics cannot distinguish "old version
present" from "current version present". Hash- or version-based comparison
restores update capability while keeping idempotency.

## Side Effects / Tradeoffs

- Replace-in-place must preserve anything the user appended *outside* the
  sentinels (e.g. lean-ctx-generated blocks live before the marker).
- Editing the repo template alone never fixes running installs — propagation
  requires image rebuild + container recreate **and** the script fix (or the
  manual step above).

## Evidence

- `Dockerfile:260-262` comment documents the append flow.
- Container `/etc/opencode/AGENTS.md.default` contained the new section
  (`grep -c 'Triage Hides'` = 1, mtime 2026-08-24 06:49); container started
  15:07 the same day; `diff` of `~/.config/opencode/AGENTS.md` vs
  `.opencode/AGENTS.md.default` showed all three newer sections absent and an
  orphaned older `Defensive jq Usage` copy retained.
- Entry-point logic quoted verbatim from `/entrypoint.d/02-init-config.sh`.

## Related Files

- `.opencode/AGENTS.md.default` (template, repo)
- `entrypoint.d/02-init-config.sh` (repo mirror of `/entrypoint.d/02-init-config.sh`)
- `Dockerfile` (~line 260, COPY + comment)
- `~/.config/opencode/AGENTS.md` (live injected file)
- `docs/knowledge/troubleshooting/lean-ctx-triage-blinds-diagnostic-output.md` (companion: triage behavior)

## Tags

agents-md, entrypoint, idempotency, sentinel, docker, opencode, config-sync
