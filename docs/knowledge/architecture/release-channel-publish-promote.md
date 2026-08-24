# Release Channels: Publish Versions, Promote `latest` Explicitly

## Context

ai-engkit ships as a self-hosted image (`ghcr.io/tryweb/ai-engkit`) that external
users deploy via `docker-compose.yml` and upgrade through either the host-side
`upgrade.sh` or the admin dashboard's one-click upgrade (`src/admin/lib/upgrade.ts`,
`runUpgrade()`). Both historically pulled the floating `:latest` tag, and CI moved
`:latest` on **every** tag push.

As the user base grew, `:latest` effectively became the default release channel for
most deployments — so every release instantly reached everyone who upgraded.

## Problem

- **No soak window**: cutting `vX.Y.Z` immediately repointed `:latest`; any user who
  clicked "upgrade" the next morning received an unvalidated release.
- **No rollback story**: once `latest` moved, there was no supported way back to the
  previous version without manual registry surgery.
- **No staging semantics**: our own environment validated releases *after* they were
  already public.
- **No version pinning**: production could not hold a known-good version; `pull && up -d`
  silently jumped multiple versions at once.

## Solution

Separate **publishing** a release from **recommending** it (implemented 2026-08,
commits `7ffad33`, `5a7d1a5`, `9ae1e24`, `0a29042`, `b6fb549`):

### 1. Publish = immutable version tags only

`.github/workflows/ci.yml` release paths push `:{version}` and `:sha-*` only.
The two `docker tag ai-engkit:ci "${IMAGE}:latest"` lines were removed.

### 2. Promote = explicit, manual, digest-preserving

New `.github/workflows/promote.yml` (`workflow_dispatch`, input `version`):

- validates `^v[0-9]+\.[0-9]+\.[0-9]+$`
- `docker pull :{version}` → re-tag `:latest` → push (**same digest, never rebuilt**)
- `gh release edit {version} --latest=true`
- appends a "Promoted to stable channel: <date>" line to the release notes
- serial concurrency (`cancel-in-progress: false`) — one promotion at a time

### 3. Version pinning via `AI_ENGKIT_VERSION`

A deployment can set `AI_ENGKIT_VERSION=v0.4.2` in `/opt/ai-engkit/.env`:

| Surface | Behavior when pinned |
|---------|---------------------|
| `docker-compose.yml` | both services resolve `ghcr.io/tryweb/ai-engkit:${AI_ENGKIT_VERSION:-latest}` |
| `src/admin/lib/image-ref.ts` | `resolveImageRef()` returns the pinned ref; used by `upgrade.ts` (pull + preflight fallback compose), `versions.ts` (update-check manifest), `commands.ts` (ai-admin restart) |
| `upgrade.sh` | `resolve_pins()` redirects raw asset fetches to the matching GitHub tag and pulls the pinned image |
| upstream assets | `fetchLatestCompose()` / `.env.example` merges fetch from `https://raw.githubusercontent.com/tryweb/ai-engkit/<pinned-tag>` instead of `main` |

Unset ⇒ everything tracks stable (`:latest` / raw refs on `main`) exactly as before.

## Why It Works

- **Users tracking `:latest` need no migration.** The admin update check compares
  local vs remote digests (`docker manifest inspect :latest`); until promotion the
  digests match and the badge says up-to-date. Promotion is what lights it up —
  the whole user base becomes a slow ring automatically.
- **Build once, promote.** Staging validates the exact digest that later reaches
  production; parity comes from promoting artifacts, not rebuilding them.
- **Rollback is re-promotion.** Pointing `:latest` back at the previous tag makes
  every pinned-latest deployment converge on the next check.
- **Hotfixes stay fast.** Promotion is manual, so a critical fix can skip the soak
  window entirely — the operator decides the cadence.
- **Pinned installs stay coherent.** Because upgrade assets are fetched from the
  pinned ref, a v0.4.1 install can never receive a compose file written for v0.5.

## Side Effects / Tradeoffs

- **Release ≠ rollout.** Cutting a tag changes nothing for users until someone runs
  Promote stable. Forgetting to promote stalls distribution — make promotion part of
  the release ritual (staging validate → promote).
- **Scan baseline meaning shifted (for the better):** `scan`'s "Pull published baseline"
  step compares candidates against `:latest`, which now means *last promoted stable* —
  i.e., what users actually run.
- **CI tiers changed:** PRs run only the cached image build (`build` job); integration
  suites, UI smoke, and vuln scans run post-merge on `main` and on tags. Trunk health
  depends on fixing post-merge failures immediately (fix-forward).
- **Docs-only PRs trigger no checks** (`paths-ignore: '**.md', 'docs/**'`). With branch
  protection requiring status checks, such PRs stall on "Expected" — merge them via a
  trivial code-touch or a bypass rule.
- **Superseded runs cancel:** `concurrency` with `cancel-in-progress` means rapid
  pushes only test the newest commit; land changes in meaningful units.

## Evidence

- Commits: `7ffad33` (ci tiering + drop auto-latest), `5a7d1a5` (promote.yml),
  `9ae1e24` (image-ref helper + adopters), `0a29042` (compose parametrize),
  `b6fb549` (upgrade.sh pin support).
- Both workflows parse cleanly (`yaml.safe_load`; ci jobs: build, test, scan, push,
  release, auto-tag; promote: single `promote` job).
- `bash -n upgrade.sh` passes; `bun` import smoke loads all four touched TS modules;
  related suites pass 24/24 (`upgrade-event-bridge`, `client`, `env-redact` tests).
- Marker greps: zero remaining `docker tag …:latest` pushes in ci.yml; zero hardcoded
  `ghcr.io/tryweb/ai-engkit:latest` constants in admin sources (the sole remaining
  literal in `upgrade.sh` is `resolve_pins()`'s unset-fallback default).

## Related Files

- `.github/workflows/ci.yml` — tiered pipeline, versioned-only publishing
- `.github/workflows/promote.yml` — the promotion workflow
- `src/admin/lib/image-ref.ts` — `resolveImageRef()` helper
- `src/admin/lib/upgrade.ts`, `src/admin/routes/versions.ts`, `src/admin/agent/commands.ts` — consumers
- `upgrade.sh` — host-side pin resolution (`resolve_pins()`)
- `docker-compose.yml`, `.env.example` — `${AI_ENGKIT_VERSION:-latest}` contract
- `docs/knowledge/patterns/docker-digest-update-check.md` — the update-check mechanism this design leans on
- `docs/knowledge/patterns/version-management-pipeline.md` — dependency-pin lifecycle feeding releases (check-updates → release skills)

## Tags

`release-process` `latest-tag` `promotion` `version-pinning` `AI_ENGKIT_VERSION`
`staging` `rollback` `ci-tiering` `ghcr`
