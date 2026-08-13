## ADDED Requirements

### Requirement: Remote commands mutate the same registry as the local admin API

Provider key commands issued by the Center Server SHALL mutate the same
`provider-keys.json` registry through the same library functions the local
admin API uses. There SHALL be exactly one registry store and one set of
mutation functions; remote and local writes are interchangeable. Remote
mutations SHALL be restricted to key-managed providers
(`isKeyProviderSupported()`, initially `opencode-go`).

#### Scenario: Remote add writes the shared registry
- **WHEN** the center issues `providers.key.add`
- **THEN** the key is appended to `provider-keys.json` by the same function
  the local admin route calls

#### Scenario: Remote selection is visible locally
- **WHEN** the center issues `providers.key.set-active`
- **THEN** the active selection in the registry is updated
- **AND** the local admin Providers page reflects the same selection

#### Scenario: Unsupported provider is rejected remotely
- **WHEN** a remote key command names a provider outside the key-managed
  whitelist
- **THEN** no registry change is made and an `error` is returned

### Requirement: Remote key changes apply to the auth store like local changes

A remote `providers.key.set-active` or `providers.key.delete` that changes the
active key SHALL apply the resulting active key to the ai-dev opencode auth
store (`applyActiveKey` / `removeAuthKey` + cache clear), matching the local
apply pipeline, and SHALL restart ai-dev per the requested restart mode.

#### Scenario: Remote set-active applies the key
- **WHEN** the center sets a key active remotely
- **THEN** the active key is written into the ai-dev auth store and the
  provider cache is cleared, exactly as the local route does

#### Scenario: Remote delete of the last key clears the auth store
- **WHEN** the center deletes the provider's only key remotely
- **THEN** the provider's entry is removed from the auth store and the
  provider cache is cleared

### Requirement: Key values are never returned by remote operations

Remote operations SHALL return masked key identifiers (`maskKey`, first 4 +
last 4 characters) and the active flag; plaintext key values SHALL NOT appear
in any remote command response, matching the local list API's masking
contract.

#### Scenario: Remote ack masks key values
- **WHEN** the agent acknowledges a remote key mutation
- **THEN** the ack payload contains only masked keys or key ids, never the
  plaintext value
