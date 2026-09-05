## ADDED Requirements

### Requirement: Turn terminal reasons are durably classifiable
Kun SHALL persist an optional bounded machine-readable terminal code with a failed Turn whenever a stable terminal reason is available.

#### Scenario: Manager expires a Runtime execution lease
- **WHEN** Manager reconciliation directly fails a running turn because its owner lease expired
- **THEN** the Turn SHALL be failed with `terminalCode` equal to `owner_lease_expired`, SHALL carry Manager-authored owner/fence/settlement provenance, and the existing canonical error item SHALL remain available to public clients

#### Scenario: Older Turn data is loaded
- **WHEN** a persisted Turn has no `terminalCode`
- **THEN** the Turn SHALL remain valid and readable without migration

#### Scenario: Replacement Runtime registers after predecessor expiry
- **WHEN** a replacement registration observes expired predecessor execution leases
- **THEN** Manager SHALL durably fail and annotate every affected turn before accepting the replacement Runtime registration

### Requirement: Manager-settled ownership interruptions resume exactly once
Kun SHALL reconcile a recoverable ownership-expiry failure into the existing continuation pipelines only when that failure remains the latest authoritative turn state.

#### Scenario: Active goal's latest turn expired
- **WHEN** a non-archived primary or fork thread is idle, its latest turn failed with `owner_lease_expired`, no newer turn exists, and its goal is active
- **THEN** startup reconciliation SHALL write one deterministic interruption checkpoint and schedule one goal continuation with the existing goal state and todos

#### Scenario: Ordinary thread's latest turn expired
- **WHEN** an eligible idle ordinary thread has the same latest terminal code and automatic resume is enabled
- **THEN** it SHALL enter the existing ordinary interruption resume flow and retain its cooldown and capacity rules

#### Scenario: Reconciliation is repeated
- **WHEN** startup or recovery scanning runs more than once for the same failed turn
- **THEN** Kun SHALL NOT create a duplicate interruption checkpoint or continuation turn

#### Scenario: Interruption checkpoint cannot be committed
- **WHEN** the deterministic checkpoint write conflicts or the backing store rejects it
- **THEN** the thread SHALL NOT be returned for automatic continuation during that scan

#### Scenario: Thread is not eligible
- **WHEN** the thread is archived, is a side thread for ordinary recovery, has a newer turn, is queued or running, has a different terminal code, or has a non-active goal state
- **THEN** Kun SHALL skip automatic goal recovery for that failure; ordinary-recovery eligibility remains governed by the ordinary continuation policy

#### Scenario: Ordinary work follows a retained non-active goal
- **WHEN** the exact latest failed source belongs to a thread that retains a completed, paused, blocked, or usage-limited goal record
- **THEN** startup reconciliation SHALL route it through ordinary continuation instead of dropping it or relaunching the inactive goal

#### Scenario: Legacy canonical error identifies the interruption
- **WHEN** the latest failed turn predates the Manager provenance fields, its own deterministic canonical error item has code `owner_lease_expired`, and it falls within the bounded startup recovery window
- **THEN** reconciliation SHALL classify it using that exact item and apply the same eligibility and exactly-once rules

#### Scenario: Unproven or stale recovery code is present
- **WHEN** a new record has only a caller-supplied terminal code, or a settlement is older than the startup recovery window
- **THEN** startup reconciliation SHALL NOT schedule automatic continuation

#### Scenario: Recovery eligibility changes before admission
- **WHEN** a newer turn appears after scanning or the goal is no longer active before continuation admission
- **THEN** continuation admission SHALL atomically reject that exact source turn, and a goal-path candidate SHALL NOT switch paths in the middle of that scan

#### Scenario: Child recovery evidence belongs to an older parent turn
- **WHEN** a resumable child record names a parent turn other than the exact latest failed recovery source
- **THEN** startup reconciliation SHALL discard that child evidence and SHALL NOT use it to reroute or enrich the continuation

#### Scenario: Foreground or unmanaged startup scans persisted settlements
- **WHEN** Runtime startup does not register through Manager but opens a data directory containing Manager-settled interruptions
- **THEN** it SHALL apply the same bounded startup recovery window and SHALL NOT resume arbitrarily old work

### Requirement: Renderer state follows canonical interruption snapshots
The renderer SHALL preserve omitted goal/todo fields for provider compatibility, SHALL clear them when the Runtime explicitly returns null, and SHALL present recoverable ownership interruptions without initiating automatic recovery.

#### Scenario: Canonical snapshot explicitly clears goal and todos
- **WHEN** a reconciled detail contains `goal: null` or `todos: null`
- **THEN** the corresponding active projection and prefetched snapshot SHALL clear the prior value instead of falling back to stale state

#### Scenario: Compatible provider omits goal and todos
- **WHEN** a reconciled snapshot leaves either field undefined
- **THEN** the renderer SHALL preserve the prior projected or summary value for that field

#### Scenario: Older detail arrives after a newer turn projection
- **WHEN** a delayed detail response belongs to an older sequence or turn than the renderer's current projection
- **THEN** it SHALL NOT overwrite newer goal, todo, sidebar, processing, or current-turn state and SHALL NOT advance the SSE cursor past events it did not import

#### Scenario: Recoverable lease error is idle
- **WHEN** `owner_lease_expired` is rendered for the latest settled main-thread turn, the whole thread is idle, and the parent provides a Continue action
- **THEN** the renderer SHALL show localized recovery guidance, retain raw code/message details, and expose the existing Continue control

#### Scenario: Recovery is already processing or the error is historical
- **WHEN** the thread is processing, a newer turn exists, or no Continue action is supplied
- **THEN** the renderer SHALL not expose a duplicate Continue control and SHALL not start recovery itself
