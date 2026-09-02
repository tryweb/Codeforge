## MODIFIED Requirements

### Requirement: Real usability proof
The system SHALL distinguish catalog visibility, provider connectivity, and real model usability. A model SHALL be eligible for automatic assignment only when it exists in the connected-provider catalog and a temporary-session inference request succeeds with response metadata matching the requested provider and model. Catalog visibility or connectivity alone SHALL NOT mark a model healthy. A provider quota-exhausted response SHALL be treated as a terminal inability to prove usability, SHALL NOT be retried as a transient failure during the same reconciliation decision, and SHALL NOT authorize automatic replacement.

#### Scenario: Visible model fails inference
- **WHEN** a model appears in the connected catalog but its temporary-session inference reports unavailable or retired
- **THEN** the system does not select that model automatically

#### Scenario: Inference resolves another model
- **WHEN** temporary-session inference succeeds but response metadata identifies a different provider or model
- **THEN** the system classifies the result as mismatch and does not treat the requested model as healthy

#### Scenario: Inference confirms requested model
- **WHEN** temporary-session inference succeeds with metadata matching the requested provider and model
- **THEN** the system classifies that model as healthy for the current provider credential

#### Scenario: Provider quota prevents proof
- **WHEN** temporary-session inference reports free-usage exhaustion, insufficient quota, or an equivalent terminal billing limit
- **THEN** the system does not classify the model as healthy, does not automatically replace the current configuration, and reports a quota-limited result

### Requirement: Bounded probing
Each reconciliation run SHALL enforce configured limits on concurrent inference probes and distinct provider-credential/model combinations. The system SHALL stop probing for an Agent after selecting its first healthy candidate and SHALL NOT scan the complete catalog solely to populate cache health. When a provider/model returns a terminal quota-exhausted result, the system SHALL store that result for 900 seconds in the provider/model/credential-fingerprint-scoped cache, stop equivalent probes for that provider/model during the run, and SHALL defer new probes until the 900-second cooldown expires. A successful credential mutation for that provider SHALL invalidate the cached quota result.

#### Scenario: Run reaches probe limit
- **WHEN** candidate evaluation reaches the configured distinct-probe limit
- **THEN** the system starts no additional probes during that run and leaves unevaluated Agents unchanged

#### Scenario: Healthy candidate stops Agent probing
- **WHEN** a candidate proves healthy for an Agent
- **THEN** the system does not probe lower-ranked candidates for that Agent during the run

#### Scenario: Quota result stops equivalent probing
- **WHEN** a provider/model probe reports a terminal quota limit
- **THEN** the system starts no additional equivalent inference probes during that run and records a provider/model/credential-fingerprint-scoped cooldown result for 900 seconds
