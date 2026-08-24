# jq Cannot Index Array with String "id" — bind before index()

## Context

Shell scripts in ai-engkit filter provider catalogs with jq, e.g.
`scripts/agent-model-health.sh` `catalog_from_provider_json()` builds
`provider/model` lines from `/provider` JSON
(`{connected: [...], all: [{id, models}]}`).

## Problem

The connected-only filter:

```bash
select(($connected | index(.id)) != null)
```

fails at runtime with:

```
jq: error (at <stdin>:1): Cannot index array with string "id"
```

`index(.id)` evaluates `.id` against the piped input of `index`, which is the
`$connected` **array** — so jq tries `["a","b"] | .id` and errors. The `.id`
inside `index(...)` does not refer to the current `.all[]` element.

## Solution

Bind the element's id to a variable **before** passing it to `index`:

```bash
select(.id as $id | $connected | index($id) != null)
```

## Why It Works

`index(X)` resolves X against the input of `index` (here `$connected`). Capturing
`.id as $id` first evaluates `.id` against the current element, then
`index($id)` searches the array with a plain string — no array indexing.

## Side Effects / Tradeoffs

- Symptom can masquerade as "no connected-provider models found; skipping startup
  reconciliation" because the jq error empties the catalog output.
- When the failing function is redefined by a later `source`, the override's bug
  silently replaces a working implementation — check `source` order when a shell
  script redefines functions from another script (`agent-model-health.sh` is sourced
  at the end of `reconcile-agent-models.sh` and overrides `catalog_from_provider_json`
  and `verify_runtime`).

## Evidence

- Reproduced: `printf '%s' '{"connected":["provider-a"],...}' | jq -r '<filter>'`
  → `Cannot index array with string "id"`, exit 5.
- Fixed filter returns `provider-a/good-model` and exits 0.
- `test/test-agent-model-health.sh` and `test/test-agent-model-reconcile.sh` pass
  after the fix.

## Related Files

- `scripts/agent-model-health.sh`
- `scripts/reconcile-agent-models.sh`

## Tags

jq, index, shell, provider-catalog, connected-providers, bash