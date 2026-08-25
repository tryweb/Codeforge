# Lean-ctx Reliability Evaluation

## Context

Todo 7.1 required a mutation-free G0 preflight across every running long-lived `ai-engkit` container, followed by one isolated 20-scenario lossless/comparison campaign only if G0 passed.

UTC run: `2026-08-25T10:56:03Z`
Evidence: [.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z)

## Problem

G0 did not pass for the complete running fleet. Both `ghcr.io/tryweb/ai-engkit:v1.15.6` containers have a baked `compression_level = "lite"` baseline. The plan requires stopping before measurement when any long-lived container fails G0.

## Solution

The campaign was not run. The deterministic G0 classification is `disable-routing`; no bytes, savings footer, or substitute metric was used. Todo 8 must consume this result without an override.

The two `ai-engkit-ai-dev` containers passed G0. The two `ghcr.io/tryweb/ai-engkit:v1.15.6` containers failed only the explicit baseline/global lossless requirement; all four produced the exact 33-byte sentinel and unchanged restart count, with no project override observed.

## Why It Works

Continuing after the fleet-level G0 failure would mix explicit-lossless and baked-lossy environments and would violate the evidence contract. Stopping preserves the causal boundary and prevents a false campaign conclusion.

## Side Effects / Tradeoffs

- No campaign command was executed (`campaign_command_count=0`), so no `records.json`, evaluator `verdict.json`, five-pair sample, or synthetic incident proof exists for this stopped run.
- No `--gates` command was run after G0 failed. The checked-in campaign driver was not modified.
- No long-lived container was restarted or reconfigured. No production named volume was touched or deleted. No Todo 8 routing change was applied.

## Evidence

- G0 results, raw layer observations, target enumeration, image metadata, commands, and classification: [campaign evidence](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z).
- G0 classification: [g0-classification.json](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z/g0-classification.json).
- G0 result table: [g0-results.tsv](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z/g0-results.tsv).
- Runtime image/version metadata: [g0-image-metadata.tsv](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z/g0-image-metadata.tsv).
- Cleanup and volume safety: [cleanup-receipt.txt](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z/cleanup-receipt.txt), [volume-safety.txt](/home/devuser/workspace/ai-engkit/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z/volume-safety.txt).

The observed lean-ctx version was `3.9.19 (official, https://github.com/yvgude/lean-ctx)`. Local `ai-engkit-ai-dev` image ID was `sha256:2940067ea0075a983241317bc89af92e0710a5d2b2434f138134f11034245c71`; the released image ID was `sha256:26282b43ff5d7cc7109efa98b94b0967e04e908fc8c2513de6cebd46ae475da4` with RepoDigest `ghcr.io/tryweb/ai-engkit@sha256:e50086b881e18fd2786bd8dbfa5e5642b629c1e1331afc3bb1a50b5be5ac2cc5`.

## Related Files

- `test/leanctx-reliability-gate.sh`
- `test/lib/leanctx-eval/types.ts`
- `test/lib/leanctx-eval/evaluate.ts`
- `openspec/changes/lean-ctx-reliability-gate/tasks.md`

## Tags

`lean-ctx` `reliability` `G0` `disable-routing` `maintenance` `blocked-campaign`
