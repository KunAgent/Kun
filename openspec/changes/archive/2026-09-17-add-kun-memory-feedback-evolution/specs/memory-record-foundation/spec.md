## MODIFIED Requirements

### Requirement: Lifecycle mutations keep projections consistent

Create, update, disable, restore, supersede, correct, delete, and purge operations SHALL update canonical state first and SHALL make every derived memory index converge to that state. An explicit correction SHALL create a new same-scope record and supersede the prior record rather than overwriting the prior content.

#### Scenario: Delete an indexed memory

- **WHEN** a memory is soft-deleted
- **THEN** it remains auditable in canonical state and is excluded from active FTS candidates and turn injection

#### Scenario: Purge an exact memory id

- **WHEN** an authorized purge removes a validated canonical memory id
- **THEN** its FTS row and other foundation projections are removed in the same operation or by idempotent reconciliation

#### Scenario: Index update fails after a mutation

- **WHEN** canonical mutation succeeds but index projection fails
- **THEN** the operation reports canonical success with degraded diagnostics and reconciliation repairs the projection later

#### Scenario: Correct a canonical memory

- **WHEN** an authorized user explicitly corrects the content of an active Memory
- **THEN** the new record supersedes the old record in the same scope, the old record remains auditable, and derived indexes converge without exposing both versions as active
