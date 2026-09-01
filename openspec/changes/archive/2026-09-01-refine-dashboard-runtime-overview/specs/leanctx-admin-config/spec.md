## MODIFIED Requirements

### Requirement: Local dirty and saved UI state
The LeanCTX Configuration editor SHALL track edits locally: Apply SHALL be unavailable while there are unsaved changes and SHALL become available after a successful Save. The editor SHALL NOT fetch status or drift endpoints to derive its local dirty state. The Dashboard MAY independently consume the read-only applied-snapshot contract to describe whether its Runtime Profile is confirmed applied, pending apply, saved-only, or unavailable.

#### Scenario: Unsaved edits cannot be applied
- **WHEN** the operator changes a field in the configuration editor without saving
- **THEN** Apply is disabled and the help text instructs the operator to save first

#### Scenario: Saved state re-enables Apply
- **WHEN** a Save succeeds
- **THEN** Apply becomes enabled and the editor status text confirms the saved state

#### Scenario: Dashboard reads apply state
- **WHEN** the Dashboard loads independently of the configuration editor
- **THEN** it derives Runtime Profile apply state from the applied-snapshot contract without changing the editor's local dirty-state behavior

## ADDED Requirements

### Requirement: Successful Apply records a secret-free applied snapshot
After `lean-ctx config apply` succeeds, the Admin SHALL atomically persist `/opt/ai-engkit/admin-data/leanctx-applied-snapshot.json` as a mode-`0600`, fixed-`version: 1` record containing a canonical fingerprint and Runtime Profile fields from the applied configuration. The fingerprint SHALL be SHA-256 over a recursively key-sorted JSON serialization of the complete schema-supported configuration so object key order does not change the result. Apply failure MUST NOT replace the previous snapshot. The snapshot SHALL include only its version and fingerprint plus compression level, tool profile, permission inheritance as the string enum `"on" | "off"` or `null` when unavailable, cross-project search, secret detection and redaction booleans, archive enabled, archive retention hours, and archive disk limit. Unsupported or malformed versions SHALL be ignored and fail closed to the saved-only contract.

#### Scenario: Apply succeeds
- **WHEN** Apply exits successfully
- **THEN** the current supported configuration fingerprint and Runtime Profile fields replace the previous applied snapshot

#### Scenario: Apply fails
- **WHEN** Apply exits non-zero
- **THEN** the previous applied snapshot remains unchanged

#### Scenario: Snapshot is serialized
- **WHEN** the persisted applied snapshot is inspected
- **THEN** it has mode `0600`, contains exactly the approved version, fingerprint, and Runtime Profile fields, and contains no shell allowlists, paths, URLs, tokens, API keys, account identifiers, model references, secrets, or unsupported configuration values

#### Scenario: Equivalent configurations have different key order
- **WHEN** two schema-supported configurations contain equivalent values with different object key order
- **THEN** their canonical fingerprints are equal

#### Scenario: Snapshot version is unsupported
- **WHEN** the snapshot is malformed or its version is not `1`
- **THEN** it is ignored and Dashboard apply state falls back to `Saved config only` when saved configuration remains readable

### Requirement: Dashboard apply state is derived conservatively
The Dashboard SHALL compare the canonical saved configuration fingerprint with the last confirmed applied fingerprint. Equal fingerprints SHALL produce `Applied`; differing fingerprints SHALL produce `Pending apply`; saved configuration without a snapshot SHALL produce `Saved config only`; and unreadable saved configuration with no snapshot SHALL produce `Runtime unavailable`. When a snapshot exists, displayed effective values SHALL come from the snapshot even while saved changes are pending.

#### Scenario: Saved configuration changes after Apply
- **WHEN** the saved configuration fingerprint changes after the last successful Apply
- **THEN** Dashboard apply state becomes `Pending apply` and continues to show values from the applied snapshot

#### Scenario: No applied snapshot exists
- **WHEN** saved configuration is readable but no successful Admin Apply has recorded a snapshot
- **THEN** Dashboard apply state is `Saved config only` and values are explicitly treated as saved rather than confirmed effective

#### Scenario: Saved configuration matches the applied snapshot
- **WHEN** the canonical saved configuration fingerprint equals the last confirmed applied fingerprint
- **THEN** Dashboard apply state is `Applied` and Runtime Profile values come from the applied snapshot

#### Scenario: Saved configuration and snapshot are both unavailable
- **WHEN** saved configuration is unreadable and no valid applied snapshot exists
- **THEN** Dashboard apply state is `Runtime unavailable`
