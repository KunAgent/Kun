## ADDED Requirements

### Requirement: Thread execution leases have durable monotonic fences
Every acquired thread execution lease SHALL contain a fencing token that is durable across Manager restart, unchanged by renewal, and greater than every previously issued token for that thread after reacquisition.

#### Scenario: Lease renews normally
- **WHEN** the current owner renews before expiry
- **THEN** Manager extends expiry and returns the same fencing token

#### Scenario: A new owner acquires after expiry
- **WHEN** the previous lease is reconciled and a new owner acquires the thread
- **THEN** Manager returns a strictly greater fencing token

### Requirement: Turn-owned writes require the current fence
Every turn-owned thread, item, event, usage, and event-sequence mutation MUST carry the admission lease fence, and Manager MUST validate it both before queueing and immediately before persistence.

#### Scenario: Lease expires while a write waits in a queue
- **WHEN** the fence was current at enqueue but is stale at commit
- **THEN** Manager rejects the mutation with `stale_turn_fence` and persists no part of it

#### Scenario: Late model response arrives after reconciliation
- **WHEN** an expired owner receives a model response after Manager failed the turn
- **THEN** no late assistant item, success event, usage event, or completed thread state is persisted

### Requirement: Expired lease reconciliation is single and authoritative
Manager SHALL be the only authority allowed to finalize an expired lease without the Runtime's fence, and reconciliation SHALL be idempotent.

#### Scenario: Reconciliation is retried
- **WHEN** Manager repeats reconciliation after a partial or previously completed attempt
- **THEN** history contains at most one terminal error item and one terminal event for that turn

### Requirement: Fencing cannot silently downgrade
A Runtime that requires turn-mutation fencing MUST reject a Manager protocol that cannot enforce it.

#### Scenario: Runtime connects to an old Manager
- **WHEN** capability negotiation reports no turn-mutation fencing
- **THEN** the connection fails with a concrete protocol mismatch before any turn can start
