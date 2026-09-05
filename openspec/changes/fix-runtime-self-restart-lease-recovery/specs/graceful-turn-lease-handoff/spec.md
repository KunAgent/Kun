## ADDED Requirements

### Requirement: Runtime shutdown drains execution leases before teardown
Kun SHALL suspend active work and wait for Manager acknowledgement of all execution-lease releases before closing persistent stores or unregistering the Runtime.

#### Scenario: Runtime gracefully shuts down with active Direct or Graph turns
- **WHEN** shutdown begins while one or more turns hold Manager execution leases
- **THEN** Kun SHALL stop new admission, quiesce execution, durably suspend the turns while retaining ownership, stop Graph execution, wait for active runs, drain the leases, and only then close stores and unregister

#### Scenario: Multiple leases are held during shutdown
- **WHEN** shutdown drains more than one execution lease
- **THEN** release requests SHALL run independently in parallel and one failure SHALL NOT prevent attempts for the remaining leases

#### Scenario: An earlier shutdown phase fails
- **WHEN** suspension, Graph stop, or active-run settlement reports an error
- **THEN** Runtime shutdown SHALL still attempt every later cleanup phase including execution-lease drain and SHALL report the collected failure set

#### Scenario: A release response reports no matching lease
- **WHEN** Manager responds `{released:false}` to a shutdown release request
- **THEN** the client SHALL treat the lease as already absent and complete that release idempotently

### Requirement: Lease-client closing is race safe
The Manager lease client SHALL prevent late acquire or renew responses from restoring executable ownership after shutdown has entered its closing state.

#### Scenario: Acquire completes after closing starts
- **WHEN** an in-flight acquire succeeds after lease-client shutdown begins
- **THEN** the client SHALL immediately release the lease and SHALL NOT return it as runnable ownership

#### Scenario: Renew completes after closing starts
- **WHEN** an in-flight renewal response arrives after shutdown begins
- **THEN** the client SHALL NOT reinstall a renewal timer, lease entry, or mutation fence

#### Scenario: Normal release races shutdown
- **WHEN** turn cleanup and client shutdown release the same turn concurrently
- **THEN** both paths SHALL share one pending release and SHALL NOT send duplicate Manager mutations

#### Scenario: Same turn is reacquired while its release is pending
- **WHEN** a continuation requests the same thread and turn identity before the prior release completes
- **THEN** acquire SHALL wait for that release acknowledgement before requesting a fresh Manager lease and SHALL fail closed if the release fails

#### Scenario: Old release races a new same-turn generation
- **WHEN** an old generation's delayed release settles after the same turn ID has acquired a newer fencing token
- **THEN** the old completion SHALL NOT stop renewal, clear ownership, or remove the mutation fence for the newer generation

#### Scenario: Release transport retries are exhausted
- **WHEN** Manager never acknowledges a generation's release within the bounded retry policy
- **THEN** the client SHALL retain that generation's fail-closed mutation fence, continue draining other leases, and report the failure

### Requirement: Shutdown closes the turn-admission critical section
Kun SHALL reject new execution admission after shutdown begins and SHALL wait for already-entered admission mutations before suspending work.

#### Scenario: Start or resume races shutdown preparation
- **WHEN** a turn start, steer, or Graph resume mutation has entered admission while shutdown closes the gate
- **THEN** shutdown SHALL wait for that mutation to leave the critical section and later admission attempts SHALL fail without acquiring runnable ownership

#### Scenario: Automatic continuation is running during shutdown
- **WHEN** a goal or ordinary restart continuation has launched before shutdown closes admission
- **THEN** it SHALL be tracked by the host's active-run barrier and shutdown SHALL wait for its suspended cleanup before draining execution leases

### Requirement: Graceful suspension accounts only reliable goal time
Kun SHALL persist elapsed goal time measured up to a graceful turn suspension before releasing ownership and SHALL exclude Runtime downtime and unmeasured crash time.

#### Scenario: Active goal is suspended for planned Runtime replacement
- **WHEN** AgentLoop unwinds a suspended turn during graceful shutdown
- **THEN** it SHALL finalize that run's elapsed timer exactly once for the same goal generation before lease release

#### Scenario: Replacement resumes the goal
- **WHEN** a continuation starts after Runtime downtime
- **THEN** it SHALL create a new elapsed timer and SHALL NOT include the shutdown-to-resume interval

#### Scenario: Runtime ownership is lost without graceful unwind
- **WHEN** a hard crash prevents reliable suspension-time measurement
- **THEN** Kun SHALL retain the last persisted elapsed value and SHALL NOT estimate additional time
