## ADDED Requirements

### Requirement: Background jobs use a core-owned execution boundary
Kun SHALL own the durable job controller, state store, event stream, cancellation
fence, quotas, and recovery policy for every extension background job. In API v1.1,
extensions MUST NOT register arbitrary job handlers or use `context.jobs` to
launch arbitrary code or child processes. A job SHALL be created only by a
versioned core Broker operation that explicitly supports background execution,
such as a brokered media operation, and execution SHALL remain under that core
service's supervision.

#### Scenario: Media operation starts a background job
- **WHEN** an authorized extension invokes a core media operation that is defined to run as a background job
- **THEN** the Broker SHALL create an extension-owned job before dispatching the supervised work and SHALL return its stable job identifier and initial state

#### Scenario: Extension attempts to register a generic job worker
- **WHEN** extension code tries to register an arbitrary background-job handler or launch work through an unsupported `context.jobs.start` method
- **THEN** the host SHALL expose no such API and SHALL return a structured unsupported-method error

### Requirement: Job creation is admitted and durable before acknowledgement
Every core Broker operation that starts a job SHALL validate its typed input,
current permissions, workspace trust and scope, applicable quotas, and
job-kind-specific recovery policy before admission. The host SHALL bind the job
to the authenticated extension principal, persist the `queued` job and its
creation event atomically, and only then acknowledge creation. A supporting
operation SHALL accept a bounded idempotency key and MUST return the existing job
for the same owner, workspace, operation, and key instead of starting duplicate
work.

#### Scenario: Valid start is acknowledged
- **WHEN** a permitted core Broker operation admits a background request
- **THEN** it SHALL durably store the queued job and creation event before returning the job ID to the extension

#### Scenario: Start request is retried after a lost response
- **WHEN** the same extension retries a supporting start operation with the same idempotency key after the original response was lost
- **THEN** the Broker SHALL return the originally created job and SHALL NOT dispatch a second execution

#### Scenario: Start fails admission
- **WHEN** the extension lacks `jobs.manage`, lacks the initiating operation's permission, is outside its workspace scope, or exceeds an effective quota
- **THEN** the Broker SHALL reject creation before any work is dispatched or durable job record is created

### Requirement: The public job API is stable and typed
The public Host Context SHALL expose `context.jobs.get`, `context.jobs.list`,
`context.jobs.subscribe`, and `context.jobs.cancel` under the `jobs.manage`
permission, with versioned request, response, event, cursor, and error schemas.
`context.jobs` SHALL NOT expose raw JobStore, EventBus, process, or filesystem
objects. All methods SHALL derive the caller identity from the host connection
rather than accepting an authoritative extension ID from request data.

#### Scenario: Extension gets one job
- **WHEN** an authorized extension calls `context.jobs.get` with an owned job ID
- **THEN** the host SHALL return a schema-valid bounded projection of current state, progress, timestamps, terminal outcome, and permitted result references

#### Scenario: Extension lists jobs
- **WHEN** an authorized extension calls `context.jobs.list` with supported state, kind, workspace, or time filters and a page cursor
- **THEN** the host SHALL return a deterministically ordered, bounded page containing only matching owned jobs and a continuation cursor when more results exist

#### Scenario: Extension subscribes to a job
- **WHEN** an authorized extension calls `context.jobs.subscribe` for an owned job with an optional last-seen event cursor
- **THEN** the host SHALL replay eligible later events in order and then deliver live events through a bounded subscription

#### Scenario: Extension cancels a job
- **WHEN** an authorized extension calls `context.jobs.cancel` for an owned non-terminal job
- **THEN** the host SHALL durably record the cancellation request and propagate it to the core executor under the job's cancellation policy

### Requirement: Jobs have durable extension and workspace ownership
Every job SHALL persist the stable owner extension ID, creating extension version,
workspace identity and scope, core job kind and schema version, initiating
operation, permissions snapshot for audit, timestamps, and current execution
attempt. Ownership SHALL be derived from the authenticated connection. A later
compatible version with the same stable extension ID MAY read retained jobs, but
every operation SHALL reauthorize the current `jobs.manage` grant and workspace
access. Foreign callers MUST NOT learn whether a guessed job ID exists.

#### Scenario: Extension supplies a forged owner
- **WHEN** a request payload includes another extension ID or a broader workspace as its claimed owner
- **THEN** the host SHALL ignore those claims and bind authorization to the connection's extension identity and current workspace grants

#### Scenario: Extension reads another extension's job
- **WHEN** an extension calls get, subscribe, or cancel with a foreign job ID
- **THEN** the host SHALL return the same non-disclosing not-found or unauthorized error policy used for nonexistent jobs and SHALL reveal no job metadata

#### Scenario: Extension version is upgraded
- **WHEN** a newer compatible version of the same stable extension ID lists retained jobs in an authorized workspace
- **THEN** the host SHALL expose those jobs with their original creating-version audit metadata unchanged

### Requirement: Job state and events are persisted consistently
The durable state machine SHALL use `queued`, `running`, `completed`, `failed`,
`cancelled`, and `interrupted`, with the last four states terminal. State changes,
progress snapshots, recovery checkpoints, execution-attempt metadata, bounded
results, structured errors, and events SHALL survive Kun restart according to
documented retention policy. Each accepted transition SHALL atomically persist
the new state and its corresponding event so state snapshots and replay cannot
contradict one another.

#### Scenario: Runtime stops after a transition
- **WHEN** Kun exits after acknowledging a state transition
- **THEN** the next runtime SHALL load both the acknowledged state and its corresponding event without reconstructing either from extension memory

#### Scenario: Invalid transition is requested
- **WHEN** an executor attempts a transition that is not valid from the persisted current state
- **THEN** the job controller SHALL reject it without mutating state, checkpoints, results, or event sequence

### Requirement: Progress and events are ordered, replayable, and bounded
Every job event SHALL contain its job ID, core job kind, owner scope, event type,
timestamp, execution attempt, and a monotonically increasing per-job sequence
used as an opaque cursor. Progress SHALL use a typed bounded payload capable of
representing phase, completed and total work, unit, percentage when known, and a
redacted message. The controller SHALL rate-limit or coalesce excessive progress
while preserving the latest durable progress snapshot and every state transition
and terminal event.

`context.jobs.subscribe` SHALL accept a last-seen cursor, replay retained events
with greater sequence in order, and then attach live delivery without a replay
gap. Per-subscriber queues, event size, delivery rate, and retained history SHALL
be bounded. If requested history has expired or a subscriber falls behind, the
host SHALL return a resumable cursor-expired or overflow result containing the
latest permitted snapshot and a safe resubscription cursor.

#### Scenario: Subscriber reconnects from a cursor
- **WHEN** a subscriber reconnects with cursor 17 while retained events 18 through 23 exist
- **THEN** the host SHALL deliver events 18 through 23 exactly once for that subscription in sequence order before forwarding later live events

#### Scenario: Progress producer is noisy
- **WHEN** a core executor reports progress faster than the configured persistence or delivery rate
- **THEN** the controller SHALL coalesce intermediate progress without dropping state transitions or the latest progress and SHALL NOT grow memory or storage without bound

#### Scenario: Replay cursor has expired
- **WHEN** a subscriber requests events older than the retained replay window
- **THEN** the host SHALL return the current authorized snapshot and a new cursor with an explicit gap indication rather than pretending replay was complete

#### Scenario: Terminal subscriber reconnects
- **WHEN** a subscriber reconnects to a terminal job from a cursor before its retained terminal event
- **THEN** replay SHALL include that terminal event once relative to the supplied cursor and SHALL then mark the subscription complete

### Requirement: Cancellation is idempotent and propagates to supervised work
Cancellation SHALL be owner checked, durable, and idempotent. Once accepted, the
job controller SHALL prevent undispatched work from starting, signal the active
core executor, enforce a bounded cancellation deadline, and invoke any
job-kind-specific process-tree or resource cleanup. Repeated cancellation calls
SHALL return a consistent snapshot and MUST NOT create multiple terminal events.
Cancellation of an already terminal job SHALL preserve its original outcome.

#### Scenario: Queued job is cancelled
- **WHEN** an owner cancels a queued job before dispatch
- **THEN** the controller SHALL transition it durably to `cancelled` and SHALL never start its executor

#### Scenario: Running job is cancelled twice
- **WHEN** an owner sends repeated cancellation calls while supervised work is running
- **THEN** the controller SHALL propagate one logical cancellation, perform bounded cleanup, and persist at most one `cancelled` terminal event

#### Scenario: Cancellation loses a completion race
- **WHEN** a completed terminal transition commits before a concurrent cancellation request
- **THEN** cancellation SHALL return the completed snapshot and SHALL NOT rewrite the outcome as cancelled

### Requirement: Every job has exactly one terminal fence
The job controller SHALL commit exactly one of `completed`, `failed`, `cancelled`,
or `interrupted` as a job's terminal outcome. The terminal transition SHALL
atomically persist its terminal event and permitted result or structured error.
After that fence, the host MUST reject or discard late progress, checkpoints,
events, results, retries, cancellation outcomes, and executor messages, and MUST
NOT promote partial output as a successful artifact.

#### Scenario: Completion races executor failure
- **WHEN** success and failure messages arrive concurrently for the same execution attempt
- **THEN** the first valid durable terminal transition SHALL win and the other message SHALL be fenced without a second terminal event

#### Scenario: Executor emits after termination
- **WHEN** a cancelled or interrupted executor later reports progress or success
- **THEN** the controller SHALL discard the late message and SHALL leave the terminal state, result, and event sequence unchanged

### Requirement: Quotas and retention bound job resource use
Kun SHALL enforce configurable global, per-extension, per-workspace, and
per-job-kind limits for active jobs, queued jobs, start rate, input and result
metadata size, event and progress rate, subscriber buffers, persisted event
bytes, log bytes, checkpoints, and retained terminal records. Effective limits
SHALL be the strictest applicable host, user, workspace, and operation policy.
Quota enforcement against one extension MUST NOT block, terminate, or evict an
unrelated extension's active jobs. Retention cleanup SHALL never delete an
active job and SHALL preserve user-owned exported files unless a separate
authorized file operation removes them.

#### Scenario: Extension reaches its active-job limit
- **WHEN** an extension tries to start another job at its effective concurrency limit
- **THEN** the initiating Broker operation SHALL queue it only within the bounded queue policy or reject it with a structured quota error

#### Scenario: Retention limit is reached
- **WHEN** retained terminal events or job records exceed their configured age or storage budget
- **THEN** Kun SHALL expire eligible oldest records deterministically while preserving active jobs, foreign quotas, and user-owned exported files

### Requirement: Runtime restart reconciliation is explicit and safe
At startup, Kun SHALL load all non-terminal job records before accepting new job
operations and reconcile each through the registered core job-kind recovery
adapter. `queued` jobs MAY be dispatched again after admission is revalidated.
Previously `running` jobs SHALL NOT be assumed to still run or to have completed;
they SHALL be reconciled using their persisted attempt and checkpoint.

Each core job kind SHALL declare a recovery policy. Kun SHALL resume from a
durable checkpoint or restart an attempt only when the core adapter proves that
the operation is resumable or idempotent and uses staging plus atomic output
promotion where required. Otherwise the job SHALL reach `interrupted` with an
actionable structured reason. Cancellation intent persisted before shutdown
SHALL take precedence over restart.

#### Scenario: Runtime restarts with a queued job
- **WHEN** Kun starts and loads a queued job whose owner remains enabled, authorized, and within quota
- **THEN** the controller SHALL make it eligible for bounded dispatch without creating a second job record

#### Scenario: Recoverable running job is found
- **WHEN** startup reconciliation finds a formerly running job whose core adapter can safely resume from its durable checkpoint
- **THEN** Kun SHALL start a new recorded execution attempt for the same job ID and SHALL preserve prior events and progress history

#### Scenario: Unsafe running job is found
- **WHEN** startup reconciliation cannot prove whether a formerly running non-idempotent effect completed
- **THEN** Kun SHALL transition the job to `interrupted`, SHALL expose the unknown outcome, and SHALL NOT silently replay the effect

#### Scenario: Cancel intent survived restart
- **WHEN** a non-terminal job has a durable cancellation request when Kun restarts
- **THEN** recovery SHALL perform required cleanup and terminate it as `cancelled` or `interrupted` without restarting normal execution

### Requirement: Extension-host crashes do not lose or duplicate jobs
An extension Node-host crash SHALL NOT destroy durable job state, terminate Kun,
or authorize arbitrary replay because execution is owned by core Broker services.
The controller SHALL keep supervision of core work when the job kind permits work
to outlive the initiating extension call, while revoking the crashed process's
subscriptions and mutation channels. If work depends on a connection that is no
longer valid, the recovery adapter SHALL cancel or interrupt it under the same
terminal-fence rules. Reconnection SHALL use persisted state and cursors rather
than extension memory.

#### Scenario: Extension host exits after starting a media job
- **WHEN** the initiating extension process crashes after the Broker has durably created and dispatched an independently supervised media job
- **THEN** Kun SHALL retain ownership and supervision of that job and SHALL allow the restarted owner to get or resubscribe to it from persisted state

#### Scenario: Job depends on the failed connection
- **WHEN** a core job kind cannot safely continue after the owning extension connection fails
- **THEN** the controller SHALL perform bounded cleanup and commit one `interrupted` or `cancelled` outcome without affecting other jobs or extensions

### Requirement: Disablement and uninstall fence extension jobs
Disabling an extension SHALL immediately reject new job-creating operations and
new job mutations for that principal, revoke its live subscriptions, and request
bounded cancellation of its queued and running jobs. Uninstall SHALL apply the
same fence before package removal. Jobs that cannot be proven cancelled SHALL
become `interrupted`; none SHALL continue to publish successful results after the
fence. Retained terminal metadata and audit events SHALL remain under configured
retention, while uninstall MUST NOT delete user-owned exported files. Re-enabling
or reinstalling SHALL NOT automatically replay interrupted work.

#### Scenario: Extension is disabled during a running job
- **WHEN** management disables an extension that owns active background jobs
- **THEN** Kun SHALL reject new starts, revoke subscriptions and mutation access, request cleanup, and durably terminate each affected job as `cancelled` or `interrupted`

#### Scenario: Extension is uninstalled with retained jobs
- **WHEN** package removal completes after active work has been fenced
- **THEN** Kun SHALL retain bounded terminal audit records but SHALL NOT delete exported user files or restart those jobs on later reinstall

### Requirement: Background jobs operate without a renderer
Core background jobs SHALL support creation, execution, persistence, polling,
subscription, cancellation, and recovery under `kun serve` without Electron or
an active renderer. Headless operation SHALL apply the same ownership, permission,
workspace, quota, approval, logging, cancellation, and terminal policies as the
desktop application. Absence of a trusted user surface MUST NOT imply approval
for a protected initiating operation.

#### Scenario: Headless server runs an admitted job
- **WHEN** an enabled Node extension starts an authorized non-interactive core job through `kun serve` while no GUI is attached
- **THEN** the job SHALL execute and remain observable through the same durable API and event contract used by GUI callers

#### Scenario: Headless start requires approval
- **WHEN** a protected job-creating operation requires a user decision and no trusted interaction surface is attached
- **THEN** Kun SHALL keep the request gated or fail it according to explicit headless policy and SHALL NOT auto-approve or fabricate a decision

### Requirement: Job diagnostics are bounded and secret safe
Kun SHALL record extension-scoped, job-correlated structured lifecycle diagnostics
including job ID, owner ID, core kind, schema version, state transition,
execution attempt, duration, recovery decision, cancellation cause, quota class,
and sanitized error code. Job logs SHALL be size bounded, rotating, and subject
to retention. The logging boundary MUST redact Kun-managed secrets, account
credentials, runtime tokens, signed or opaque media URLs, consent tokens, and
sensitive environment values, and SHALL NOT log raw job inputs, checkpoints,
transcripts, command output, or result payloads by default.

#### Scenario: Core executor reports a credential-bearing error
- **WHEN** an upstream error contains a token, signed URL, or sensitive command argument
- **THEN** diagnostics SHALL retain a sanitized error classification and job correlation while removing the protected value from structured logs, stderr capture, and crash summaries

#### Scenario: Job logs reach their bound
- **WHEN** an extension's job-correlated logs exceed configured size or retention limits
- **THEN** Kun SHALL rotate and expire eligible log data without deleting the durable terminal state or allowing unbounded disk growth

### Requirement: SDK and runtime provide deterministic job testing
The public SDK schemas, generated reference, and extension test kit SHALL cover
`jobs.manage` and the get, list, subscribe, and cancel API. The test kit SHALL
provide deterministic core-job fixtures or fakes, a controllable clock and
executor, persisted-store restart simulation, event cursors, quota controls,
cancellation races, host-crash simulation, and log-redaction assertions without
requiring real FFmpeg or wall-clock waits. Runtime integration tests SHALL use the
production JobStore and event boundary to verify durable ordering and recovery,
not only mocks.

#### Scenario: Extension tests a successful job lifecycle
- **WHEN** a test starts an admitted fake core job and advances its controlled executor through progress and completion
- **THEN** the harness SHALL expose the same typed snapshots, cursor-ordered events, and completed terminal fence as the production API

#### Scenario: Test simulates restart and cancellation race
- **WHEN** a test crashes the simulated runtime after a persisted running state and races recovery with cancellation
- **THEN** the harness SHALL deterministically produce one policy-valid terminal outcome and SHALL expose any late update as fenced

#### Scenario: Runtime conformance suite isolates owners
- **WHEN** conformance tests exercise foreign IDs, quota exhaustion, expired cursors, host failure, disablement, and secret-bearing errors
- **THEN** they SHALL verify non-disclosure, bounded behavior, restart persistence, exactly one terminal event, and redacted diagnostics through the real Broker authorization boundary
