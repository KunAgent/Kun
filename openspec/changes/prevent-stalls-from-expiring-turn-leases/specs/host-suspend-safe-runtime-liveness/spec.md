## ADDED Requirements

### Requirement: Host suspension preserves exclusive ownership
Manager SHALL reserve existing runtime slots, thread leases, resource leases, and fencing tokens during confirmed host suspension and a twenty-second recovery grace, while continuing to reject competing owners.

#### Scenario: Existing owner renews after wake
- **WHEN** the host resumes and the original Runtime renews during recovery grace
- **THEN** the same owner and fencing token remain authoritative and no lease-expired error is recorded

#### Scenario: Competing owner requests the thread during recovery
- **WHEN** another owner attempts acquisition before recovery grace ends
- **THEN** Manager returns busy and does not allocate a new fence

### Requirement: Host pause detection is not GUI dependent
Electron Main SHALL report suspend/resume when available, and Manager MUST also detect a large gap in its own reconciliation clock before expiring liveness state.

#### Scenario: GUI is not running during host sleep
- **WHEN** a headless Runtime and Manager resume after their scheduling clocks paused
- **THEN** Manager enters the same recovery state before evaluating expiry

#### Scenario: Duplicate power events arrive
- **WHEN** Main sends repeated suspend or resume notifications for one sleep cycle
- **THEN** Manager handles them idempotently without extending recovery repeatedly

### Requirement: Local deadlines revalidate after a scheduling gap
Runtime SHALL recognize a long local clock jump, enter a bounded renewal grace, and ask Manager to renew the same fence before declaring ownership lost.

#### Scenario: Manager confirms the original fence
- **WHEN** local deadline processing resumes after host sleep and Manager renews the same fence
- **THEN** Runtime keeps the turn active without aborting it

#### Scenario: Manager rejects the fence
- **WHEN** revalidation returns explicit lease loss
- **THEN** Runtime aborts the old execution once and Manager fencing rejects all subsequent stale writes

### Requirement: Watchdog recovery does not replace a sleeping runtime
Electron Main SHALL pause Runtime watchdog failure accounting and automatic restart while the host is suspended or inside recovery grace.

#### Scenario: Health probe runs immediately after wake
- **WHEN** Runtime has not yet answered during recovery grace
- **THEN** Main preserves the process and does not consume restart budget

#### Scenario: Owner never recovers
- **WHEN** recovery grace ends without successful registration and lease renewal
- **THEN** existing expiry, reconciliation, and configured interrupted-turn resume behavior proceeds exactly once
