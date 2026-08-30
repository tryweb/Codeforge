## Context

The upgrade page currently starts `POST /api/upgrade` without a target, while `resolveImageRef()` derives the image tag from `/opt/ai-engkit/.env`. Production Compose uses the same `AI_ENGKIT_VERSION` for both Admin and ai-dev. The GHCR OCI API provides a paginated tag-name list and tag-to-manifest resolution, but it does not provide a reverse digest-to-tags endpoint or reliable release ordering.

## Goals / Non-Goals

**Goals:**

- Keep registry access server-side and expose a small, authenticated Admin API for version discovery.
- Provide a correct official-release label by resolving `latest` to its matching formal tag through manifest digest equality.
- Sort formal `v1.x.y` tags by semantic version, return the complete normalized set once, and let the UI reveal it in batches of 10.
- Validate and persist the selected target before invoking the existing upgrade pipeline.

**Non-Goals:**

- Do not scrape the GitHub package web page or add a GitHub REST API/PAT dependency.
- Do not expose arbitrary image references, `sha-*` tags, dev builds, or pre-release tags in the selector.
- Do not change the underlying backup, health polling, reconciliation, or SSE progress pipeline.

## Decisions

### Use a server-side GHCR OCI client

Add a small supporting library used by the upgrade route. It obtains a bearer token from `ghcr.io/token`, follows `tags/list` pagination using `n` and `last`, and normalizes the complete tag set. Browser-side registry access was rejected because it couples the UI to registry authentication/CORS and makes validation easier to bypass.

### Define formal releases and ordering explicitly

Accept only tags matching `^v1\\.[0-9]+\\.[0-9]+$`, excluding pre-release suffixes and all non-release tags. Parse numeric components and sort descending by major, minor, then patch; never rely on OCI tag-list order. Keep the normalized list in a short-lived in-memory cache so `More` can serve the next slice without another registry enumeration.

### Resolve `latest` by manifest digest comparison

Request the manifest digest for `latest`, then walk formal candidates from highest to lowest semantic version and issue manifest `HEAD` requests until the first tag with the same `Docker-Content-Digest` is found. This is the only authoritative OCI-only reverse lookup and selecting the first match produces the highest formal alias. Every request SHALL use the same explicit `Accept` set for OCI image indexes, Docker manifest lists, OCI image manifests, and Docker schema-2 manifests so the references are compared at the same manifest representation. This `Docker-Content-Digest` is a manifest digest and is distinct from the existing update check's config digest. If no match exists, return `official: null` and a warning rather than inferring the highest version.

### Use one cached Admin discovery response

Expose `GET /api/upgrade/versions` returning the complete sorted formal tag list, `official_version`, the current installed version, and a warning/error state. The UI initially renders the first 10 entries and reveals the next 10 locally through `More`; this avoids offset drift when the registry changes between requests. Cache the normalized response for a short TTL and refresh it as a whole after expiry.

### Submit a semantic upgrade target

Change `POST /api/upgrade` to accept a JSON body containing the selected formal `version`. Revalidate it against a fresh discovery result (including the resolved official version), persist it with the existing environment helper as `AI_ENGKIT_VERSION`, then invoke the existing no-argument upgrade function; no upgrade pipeline signature change is needed. If discovery is unavailable or validation fails, return a client error without modifying `.env` or starting an upgrade. Keep update-check logic anchored to the literal `ghcr.io/tryweb/ai-engkit:latest` reference rather than `resolveImageRef()` so pinning does not suppress future update notifications.

### Model the UI as two radio choices

Render an official-release radio selected by default when `official_version` exists, displaying `v1.x.y (latest)`. Render a specified-version radio with a select control containing the first 10 formal tags and a `More` button that reveals the next 10 from the same response. When no official version is resolved, disable the official radio, show the warning, and select no target until the operator chooses an available formal release. Preserve the existing dev-build branch so neither the selector nor discovery is rendered for dev images.

## Risks / Trade-offs

- **[Registry latency]** Digest resolution can require manifest requests while walking formal tags → stop at the first descending match, cache the complete normalized response, and refresh only on expiry.
- **[Latest drift]** `latest` can move after the page loads → re-resolve and validate the official target when the upgrade request is submitted.
- **[No semantic alias]** `latest` can point to an unversioned or pre-release manifest → disable the official option and require an explicitly listed formal version.
- **[Registry failure]** Token, tag, or manifest requests can fail → return a clear discovery error, preserve the existing environment, and prevent a destructive upgrade with an unknown target.
- **[Version aliasing]** Multiple formal tags can share one digest → choose the highest matching formal tag for the displayed official version and keep the `latest` marker explicit.

## Migration Plan

No data migration is required. Existing installations retain their current environment value until an operator selects a target; selecting a target intentionally changes an unpinned installation to a reproducibly pinned formal tag. Update detection continues to compare against floating `:latest`, while the selected tag controls the upgrade image. Rollback is removing the new selector/API code and retaining the previous upgrade request behavior.

## Open Questions

None. The formal tag pattern, ordering, fallback behavior, pagination size, and persistence semantics are defined above.
