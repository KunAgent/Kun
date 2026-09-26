## Purpose

为 Kun 提供默认关闭的窗口式上下文策略，让模型感知容量并在同一任务中无摘要换窗，同时保持现有摘要行为、完整时间线及可靠恢复能力。

## ADDED Requirements

### Requirement: Window mode is explicitly opt-in
The system SHALL expose an independent window-mode setting defaulting to false and SHALL preserve existing summary settings and behavior when disabled.

#### Scenario: Existing installation upgrades
- **WHEN** settings omit the window-mode field
- **THEN** summary compaction remains active and no window tools or budget messages are introduced

#### Scenario: User toggles the setting
- **WHEN** the user saves the independent switch in Agents settings
- **THEN** the value survives reload and reaches the runtime without modifying saved summary parameters
- **THEN** an active turn keeps its accepted mode and subsequent turns use the new setting

#### Scenario: Unsupported model capabilities
- **WHEN** an enabled turn selects a route unable to execute the required tools
- **THEN** admission reports the unsupported capability without clearing context or silently changing strategy

### Requirement: Budget reflects the current request window
The system SHALL provide a window identifier and nonnegative remaining capacity at window start and once per crossed 25, 50, and 75 percent usage threshold. It MUST account for complete request input and output reservation without resetting cumulative task usage or changing the immutable system prefix.

#### Scenario: Queued input crosses multiple thresholds
- **WHEN** user input or tool output moves usage from below 25 percent to above 50 percent
- **THEN** the next request receives one current budget notice and covered thresholds are not repeated

#### Scenario: Window or model changes
- **WHEN** a new window starts or a different model capacity applies
- **THEN** remaining capacity is recalculated for that window and model without using old-window cumulative token usage

### Requirement: Model can start a fresh window
The enabled model SHALL be able to request a no-argument new_context operation that continues the same turn with rebuilt initial context and bounded history/notes pointers, without generating a summary or automatically carrying old conversation content.

#### Scenario: Successful transition
- **WHEN** an exclusive new_context call commits successfully
- **THEN** the next model request uses the new window, authoritative runtime context, and recovery pointers
- **THEN** old conversation messages remain retrievable and visible but are absent from the new model history

#### Scenario: Mixed tool batch
- **WHEN** new_context appears with other tool calls in one batch
- **THEN** the batch is rejected before side effects and the model is asked to invoke the transition separately

#### Scenario: Pending interaction
- **WHEN** tool results, approvals, or user-input requests remain unresolved
- **THEN** a transition does not discard or bypass those interactions

### Requirement: Automatic pressure uses the selected strategy
Window mode SHALL warn at the configured soft threshold and use bounded no-summary transition at hard pressure. Summary mode and explicit manual compact SHALL retain existing summary behavior.

#### Scenario: Automatic hard pressure
- **WHEN** the next enabled request reaches the hard threshold or cannot fit input plus output reservation
- **THEN** the system attempts one safe window transition and rechecks capacity without calling the summary model

#### Scenario: Explicit summary and later disable
- **WHEN** the user invokes manual compact while enabled, then disables window mode
- **THEN** manual compact creates a summary boundary and subsequent turns use summary policy from the last valid boundary without expanding all old history

#### Scenario: Unrecoverable pressure
- **WHEN** fresh initial context still does not fit, the single overflow retry fails, or overflow follows committed partial output
- **THEN** only the affected turn fails with an actionable error and no repeated reset or sampling replay occurs

#### Scenario: Repeated empty resets
- **WHEN** the model requests another transition without ordinary work since its last transition
- **THEN** the operation is rejected instead of creating an unbounded sequence of windows

### Requirement: Transitions are durable and input-safe
The system MUST commit recoverable window boundaries atomically and idempotently, preserve concurrently accepted input, and resume from the last committed boundary.

#### Scenario: Concurrent input arrives
- **WHEN** new input is appended during a transition
- **THEN** the transition cannot overwrite it and input after the committed cut remains in the new window

#### Scenario: Storage failure or cancellation before commit
- **WHEN** history archival or checkpoint commit fails, or cancellation occurs before commit
- **THEN** the original window stays active with its history intact

#### Scenario: Restart after commit
- **WHEN** the process restarts or the operation is retried after checkpoint commit
- **THEN** the committed window is restored once without duplicate side effects or another increment

### Requirement: Window transitions preserve the task timeline
Clients SHALL distinguish a window transition from summary compaction while retaining the original task and visible messages.

#### Scenario: SSE replay
- **WHEN** a client reconnects and replays the transition event
- **THEN** the timeline contains one window marker in chronological position and no messages disappear
