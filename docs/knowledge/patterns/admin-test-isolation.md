# Isolate Admin Test Module State

## Context

The admin test suite runs under Bun and includes tests that mock modules and mutate process-wide environment variables.

## Problem

- A module-scope `mock.module("node:fs", ...)` polluted other tests and interfered with filesystem-dependent behavior.
- `src/admin/server.test.ts` set `process.env.ADMIN_PASSWORD` at module scope without restoring the caller's environment.

## Solution

- Inject filesystem checks such as `composeFileExists` into `createRealCommandDeps()` instead of mocking `node:fs` globally.
- In tests that set `ADMIN_PASSWORD`, save the original value and restore it in `afterAll`; delete it when it was originally unset.

## Why It Works

Dependency injection limits the test double to the code path that needs it, while explicit environment restoration prevents module-scope setup from leaking into later tests or the test runner process.

## Side Effects / Tradeoffs

- `createRealCommandDeps()` has one additional dependency parameter with a production default.
- Tests must maintain cleanup logic whenever they mutate process-wide state.

## Evidence

- `bun test` in `/opt/admin`: `Ran 435 tests across 40 files. [8.35s]`, exit code `0`.
- Focused server test: `3 pass`, `0 fail`.
- Docker image rebuild and `ai-admin` recreation completed successfully.
- `git diff --check` passed after the implementation.

## Related Files

- `src/admin/agent/commands.ts`
- `src/admin/agent/commands-restart.test.ts`
- `src/admin/server.test.ts`

## Tags

`bun` `testing` `dependency-injection` `mock-isolation` `environment-cleanup` `admin`
