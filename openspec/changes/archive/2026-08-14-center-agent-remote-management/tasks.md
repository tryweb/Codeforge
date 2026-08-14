# Tasks: center-agent-remote-management

## 1. Protocol plumbing (src/admin/agent/protocol.ts)

- [x] 1.1 Extend `CommandName` and `QueryName` unions with the 17 new command names (`secrets.set`, `ssh.key.add`, `ssh.key.delete`, `ssh.key.list`, `git.config.set`, `git.config.get`, `gh.auth.start`, `gh.auth.logout`, `glab.instance.add`, `glab.instance.remove`, `glab.instances`, `projects.create`, `projects.set-remote`, `projects.enable`, `projects.disable`, `projects.enable-feature`, `projects.sync`)
- [x] 1.2 Extend `parseCommandName()` and `parseCommandType()` switches to accept the new names — `parseCommandName` returns non-null for every new action command
- [x] 1.3 Add an optional `data` parameter to `buildAck()` and the ack outcome type — `{ status, message, started_at, finished_at, data? }`
- [x] 1.4 Add protocol unit tests: new command names parse to the right type; unknown names still return null; ack with `data` builds correctly

## 2. Domain library extraction (src/admin/lib/ + routes rewiring)

- [x] 2.1 Create `lib/secrets.ts` — export `SECRETS_SCHEMA`, `setSecret()`, `getSecretActivationStatus()`; rewire `routes/secrets.ts` to delegate
- [x] 2.2 Create `lib/ssh-keys.ts` — `listKeys()`, `addKey()`, `deleteKey()`, `getPublicKey()`; rewire `routes/ssh-keys.ts`
- [x] 2.3 Create `lib/git-config.ts` — `readGlobalConfig()` (drops `credential.*`/`url.*`, masks key-like values), `setGlobalConfig()`; rewire `routes/git-config.ts`
- [x] 2.4 Create `lib/gh-auth.ts` — `getGhStatus()`, `startDeviceFlow()` (returns `{ device_code, verification_uri }`), `logout()`; rewire `routes/gh-auth.ts`
- [x] 2.5 Create `lib/glab-auth.ts` — `normalizeHostname()`, `login()`, `logout()`, `listInstances()`, `setupCredentialHelper()`; rewire `routes/glab-auth.ts`
- [x] 2.6 Create `lib/projects.ts` — `createProject()`, `setRemote()`, `enable()`, `disable()`, `enableFeature()`, `sync()` extracted from `routes/projects.ts` and `routes/project-sync.ts`; rewire both routes to delegate
- [x] 2.7 Run the existing route test suites (`secrets`, `ssh-keys`, `git-config`, `gh-auth`, `glab-auth`, `projects.test.ts`, `project-sync.test.ts`, `agent.test.ts`) — all stay green; the only local behavior change is the SSH key name validation fix in 2.2

## 3. Command handlers (src/admin/agent/commands.ts)

- [x] 3.1 Extend `CommandDeps` with shared-function bindings for the six new domains (secrets, ssh-keys, git-config, gh-auth, glab-auth, projects) and wire the production defaults
- [x] 3.2 Add `secrets.set` handler — schema-key whitelist, non-empty value, ack with activation status, no restart, no value echo
- [x] 3.3 Add `ssh.key.add` / `ssh.key.delete` / `ssh.key.list` handlers — name/type validation (no path separators or shell-active characters, enforced in the shared lib), passphrase containment, agent registration on add, `{ name, type, fingerprint }` list result
- [x] 3.4 Add `git.config.set` handler — non-empty key/value validation
- [x] 3.5 Add `gh.auth.start` handler — launches device flow, briefly retries reading the device-code log so the ack `data: { device_code, verification_uri }` is reliably populated; add `gh.auth.logout` handler
- [x] 3.6 Add `glab.instance.add` (hostname normalize + token login + credential helper, token never echoed) and `glab.instance.remove` handlers
- [x] 3.7 Add `projects.create`, `projects.set-remote`, `projects.enable`, `projects.disable` handlers — reuse `lib/projects.ts`, `isValidProjectName()` validation
- [x] 3.8 Add `projects.enable-feature` handler — `knowledge`/`maintenance`/`openspec` whitelist — and `projects.sync` handler (`add`/`remove` arrays)
- [x] 3.9 Add `git.config.get` query handler — masked config result — `glab.instances` query handler — `{ hostname, username, authenticated }` result — and `ssh.key.list` query handler — `{ name, type, fingerprint }` result
- [x] 3.10 Verify unknown/malformed payloads for every new command return `unknown_command` / `malformed_command` with no side effects

## 4. Tests

- [x] 4.1 Add handler unit tests in `commands.test.ts` for each new command: valid payload success path, validation rejection, failure ack
- [x] 4.2 Add containment tests: `secrets.set` ack and `glab.instance.add` ack contain no plaintext value; `git.config.get` drops `credential.*`/`url.*` and masks key-like values; `glab.instances` result has no token
- [x] 4.3 Add `gh.auth.start` test asserting the ack carries `data` with device code + verification URI and that the code is absent from logs
- [x] 4.4 Extend `integration.test.ts` with one end-to-end command per domain (secrets, ssh, git, gh, glab, projects) using injected fakes
- [x] 4.5 Add unit tests for the extracted libs with no existing route coverage (`secrets`, `ssh-keys`, `git-config`, `gh-auth`, `glab-auth`) — fake-adapter injection covers success, validation-rejection, and failure paths, including the SSH key path-traversal rejection

## 5. Docs

- [x] 5.1 Update `docs/specs/agent-center-protocol.md` with the full wire contract: command names, payloads, ack/result shapes, containment rules
- [x] 5.2 Run `openspec validate` on the change and confirm all artifacts pass
