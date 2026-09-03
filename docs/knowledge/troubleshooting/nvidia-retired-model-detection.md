# Nvidia Model Failure Classification: Retired vs Wrong Endpoint

## Context
ai-engkit verifies Nvidia models (e.g., `nvidia/deepseek-ai/deepseek-v4-flash`) through a managed OpenCode server (`1.18.25`) in the dev environment (`ai-engkit-dev` / `ai-engkit-admin-dev` via `docker-compose.dev.yml`). Verification uses `POST /session/:id/prompt_async` + polling `GET /session/:id/message` and `GET /session/status`.

## Problem
NVIDIA catalog entries can fail for different terminal reasons. A retired model must not be confused with a model that is cataloged but unavailable through the selected endpoint family. Previously, `nvidia/deepseek-ai/deepseek-v4-flash` appeared as `timeout` or empty reply via `GET /api/agent-models/verify-model`, masking the real `410` error:

- Direct probe returned within 2s: assistant `error` with `statusCode 410`, not a timeout.
- Admin `verify-model` returned `probe polling timed out after 90 seconds` or `curl (52) Empty reply from server` with `[Bun.serve]: request timed out after 10 seconds`.

This misclassifies a conclusively retired model as transient.

## Solution
- **Probe transport:** `POST /session/:id/prompt_async` (204) then poll `GET /session/:id/message`. Do not infer retired from elapsed time.
- **Classification:** Inspect `assistant info.error` for `410` / `Gone` / `end of life` / `retired` / `no longer available`. Treat it as terminal `retired`.
  - Example marker: `Gone: {"status":410,"detail":"The model 'deepseek-ai/deepseek-v4-flash' has reached its end of life on 2026-08-07T09:00:00Z and is no longer available."}`
  - Inspect `404 page not found` and `Function <UUID>: Not found for account` separately. Treat these as terminal `wrong_endpoint`, not generic `unavailable`.
  - `wrong_endpoint` means the catalog entry is not usable through the LLM chat endpoint; the model may require NVIDIA's VLM/Biology endpoint or may not be deployed for the account.
  - `hasQuotaMarker` (`FreeUsageLimitError`, `429`) and `hasTimeoutMarker` (`504`, `timed out`) must be checked before `retired` to avoid misclassifying quota as retired.
- **Status handling:** `GET /session/status` may be `{"type":"busy"}` initially; skip `busy` as transient. Only terminal `retry` with quota message or direct `410` should be terminal. Check `to_entries | select(.key==$sid)` for per-session map shape.
- **Infrastructure:** `Bun.serve` default `idleTimeout 10s` is shorter than the 90s probe; Bun's maximum is 255s, so longer verification sweeps must be made non-blocking or emit keep-alives. The `docker exec` timeout is `90_000ms` (`execInAiDev`), which covers each per-request deadline.
- **Sanitization:** Run `sanitizeProbeReason` before caching/rendering; never persist `Authorization` or `sk-` values.
- **Dev access:** When the admin service binds to container-local `localhost`, run the authenticated verification request inside `ai-engkit-admin-dev`; the host-published port may refuse the connection even while the container is healthy.

## Quick Decision Flow
1. `assistant info.error` contains `410`, `Gone`, `end of life`, `retired`, or `no longer available` → **`retired`**; block and replace the model.
2. The payload contains `404 page not found` or `Function <UUID>: Not found for account` → **`wrong_endpoint`**; block and tell the operator to use the correct NVIDIA endpoint or verify account deployment.
3. The payload contains quota/rate-limit, timeout, or abort markers → **`quota_exceeded`**, **`timeout`**, or **`aborted`**; retain the current model and retry according to TTL.
4. Other 404/not-found responses → **`unavailable`**; block and replace when a healthy candidate exists.
5. Never classify from elapsed time alone; inspect the assistant error payload first.

## Why It Works
OpenCode surfaces NVIDIA failures inside the assistant message payload. Checking structured and serialized payloads in precedence order (`quota` → `timeout` → `aborted` → `410 retired` → narrow `wrong_endpoint` markers → generic `404 unavailable`) preserves the most specific terminal cause. The reconciler treats both `retired` and `wrong_endpoint` as replaceable, while transient `timeout`/`retryable` results remain fail-open. Both terminal statuses use the confirmed health-cache TTL.

## Side Effects / Tradeoffs
- `410` is terminal and cached for 24h (`CONFIRMED_TTL_SECONDS 86_400`); a stale retired mark will persist until cache expiry or invalidation.
- `Bun` idleTimeout increase raises resource holding time; non-blocking alternative adds polling complexity.
- Provider error formats may change; add regression fixtures before expanding markers.
- `wrong_endpoint` is intentionally a narrow marker: do not classify every `404` as wrong endpoint, because generic model-not-found responses remain `unavailable`.
- A plain-text `410 Gone` or `end of life` response must be classified as `retired` before the generic retryable fallback, not only structured assistant errors.

## Evidence
- Direct dev probe (2026-09-02, managed OpenCode `1.18.25`, `ai-engkit-dev` port dynamic):
  - `POST /session` 200, `POST /session/:id/prompt_async` 204
  - `GET /session/:id/message` 200: `assistant` with `error.name=APIError`, `data.statusCode=410`, `responseBody` contains `end of life on 2026-08-07T09:00:00Z`
  - `GET /session/status` 200: `null` (no retry, busy transient)
- Admin `GET /api/agent-models/verify-model?model=nvidia%2Fdeepseek-ai%2Fdeepseek-v4-flash` via `ai-engkit-admin-dev`:
  - Fresh without fix: `timeout` or `empty reply`
  - Direct message classification: `retired` (verified via `classifyProbeResponse` with `410` marker)
- Dev verification after rebuilding `docker-compose.dev.yml` on 2026-09-03:
  - `nvidia/deepseek-ai/deepseek-v4-flash`, `nvidia/meta/llama-3.1-8b-instruct`, `nvidia/nvidia/nemotron-mini-4b-instruct`, `nvidia/google/gemma-3n-e4b-it`, and `nvidia/qwen/qwen2.5-coder-32b-instruct` → `retired` via HTTP 410.
  - `nvidia/google/google-paligemma`, `nvidia/meta/esmfold`, and `nvidia/google/gemma-3-12b-it` → `wrong_endpoint`.
- Regression coverage: `src/admin/lib/model-probe.test.ts` and full admin suite `828 pass, 0 fail`; Biome and `git diff --check` passed.
- Logs: `[Bun.serve]: request timed out after 10 seconds` then `GET /api/agent-models/verify-model ... 200 64s` for Nvidia batch.

## Related Files
- `src/admin/lib/model-probe.ts` — `buildProbeScript`, `classifyProbeResponse`, `hasQuotaMarker`/`hasTimeoutMarker`, `sanitizeProbeReason`, health cache
- `src/admin/lib/agent-model-reconciler.ts` — `retired`/`wrong_endpoint` enable replacement vs `timeout`/`quota_exceeded` fail-open
- `src/admin/routes/agent-models.ts` — user-facing retired and wrong-endpoint verification messages
- `docs/knowledge/troubleshooting/opencode-model-request-failure-classification.md` — general failure registry (quota vs timeout vs retired)

## Tags
`nvidia` `retired` `410` `gone` `end-of-life` `deepseek-v4-flash` `opencode` `probe` `prompt_async` `Bun` `idleTimeout`
