> **Prerequisite.** `center-query-protocol` is archived. This change extends
> its `center-protocol` and `agent-command` contracts with provider-key action
> commands and restart-mode semantics, and reuses the registry/apply pipeline
> from `admin-provider-config`.

## 1. Protocol Extension (center-protocol)

- [x] 1.1 Extend the command catalog with `providers.key.add`,
      `providers.key.set-active`, `providers.key.delete`,
      `providers.key.update-note` (additive within protocol version 1)
- [x] 1.2 Add the key-material containment rule: plaintext keys appear only in
      the command payload; ack/result/event payloads carry masked keys or key
      ids only

## 2. Registry Mutation Handlers (agent-command)

- [x] 2.1 Extend `CommandDeps` with registry mutation + auth-store apply
      bindings (add/delete/set-active/update-note, applyActiveKey,
      removeAuthKey, clearProviderCache, readProviderAuthKey, active-key read,
      isKeyProviderSupported) and wire `createRealCommandDeps`
- [x] 2.2 Implement `providers.key.add`: whitelist + non-empty value
      validation; first-key apply + restart per mode; auth-store-collision
      rejection; rollback key on apply failure
- [x] 2.3 Implement `providers.key.update-note`: registry-only, no restart
- [x] 2.4 Implement `providers.key.set-active`: persist selection → apply →
      restart per mode; revert selection on apply failure; `alreadyActive`
      no-op handling
- [x] 2.5 Implement `providers.key.delete`: active-key deletion promotes next
      (apply + restart) or removes auth-store entry (last key) + restart per
      mode; non-active deletion is registry-only

## 3. Restart Modes (agent-command)

- [x] 3.1 Implement `waitForIdleSessions`: poll the chamber control API
      (`POST /api/openchamber/control`, `session.list` `withStatus: true`)
      via `execInAiDev` curl; idle = every session `status.type == "idle"`;
      busy/retry/unknown/API failure keep waiting; 10 min deadline, 15 s
      interval
- [x] 3.2 Implement graceful restart sequence: idle wait → `docker stop`
      (SIGTERM / WAL checkpoint) → `compose up -d` recreate
- [x] 3.3 Implement force path and timeout fallback: immediate
      `--force-recreate`; final `ack` message reports which mode actually ran
- [ ] 3.4 Verify chamber control API auth (uiPassword header) against the
      running container; isolate the credential/header in one helper

  > **Deviation (2026-08-13)**: not done as written — the idle probe uses the
  > opencode server API directly (`GET /session` + `/session/:id/state` via
  > `execInAiDev` curl) instead of the chamber control API, verified against
  > the running container: the control API's `session.list` returned no
  > sessions in this build while the direct probe returns live data (see
  > `commands.ts` `OPENCODE_SESSION_PROBE_SCRIPT`). No uiPassword/header
  > helper exists. Revisit if the control API becomes the authoritative
  > session-status source.

## 4. Protocol Docs

- [x] 4.1 Update `docs/specs/agent-center-protocol.md`: four new commands with
      payloads, restart-mode semantics, key-material containment rule

## 5. Verification

- [x] 5.1 Unit tests: payload validation (whitelist, empty value, unknown
      keyId, bad mode, malformed payload → `error` `malformed_command`; unknown
      command → `error` `unknown_command`)
- [x] 5.2 Unit tests: add/set-active/delete/update-note handler behavior with
      fake deps — registry calls, apply calls, rollback on apply failure,
      auth-store collision rejection
- [x] 5.3 Unit tests: no plaintext key material in any ack payload; masked
      keys only
- [x] 5.4 Unit tests: `waitForIdleSessions` with a fake chamber — idle fast
      path, busy-until-deadline → force fallback, API failure → force,
      interval cadence
- [x] 5.5 Unit tests: restart-mode selection — graceful default, explicit
      force, timeout fallback reported in final ack
- [x] 5.6 Integration test against a stub center: `providers.key.add` /
      `set-active` / `delete` / `update-note` command → two-ack round-trip
      with masked payloads; deferral during upgrade
