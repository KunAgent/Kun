## ADDED Requirements

### Requirement: Automatic plan build is a default-off Laboratory capability
The system SHALL persist Automatic plan-build settings under `agents.kun.lab.autoPlanBuild`, SHALL normalize missing settings to disabled, and SHALL expose Automatic mode only on the Code chat composer while enabled.

#### Scenario: Existing installation has no Automatic settings
- **WHEN** settings created before the feature are loaded
- **THEN** Automatic mode SHALL remain disabled and existing Agent, Plan, Graph, and manual plan-build behavior SHALL remain unchanged

#### Scenario: Experiment is disabled with a pending intent
- **WHEN** the user disables Automatic plan build
- **THEN** the composer SHALL leave Automatic mode and pending intents SHALL NOT dispatch a build

### Requirement: Automatic settings are GUI-only and independent
The system SHALL store confirmation policy, Direct or scheduled default, Automatic worktree default, and reusable scheduled model defaults independently from manual plan-build settings, and SHALL NOT forward them into Kun runtime configuration or its immutable prompt prefix.

#### Scenario: Automatic worktree default changes
- **WHEN** the user changes Automatic mode's default environment
- **THEN** future Automatic dialogs SHALL use that value and the manual Direct plan default SHALL remain unchanged

### Requirement: Automatic submissions capture execution before planning
Submitting in Automatic mode SHALL resolve Direct or scheduled execution and current-workspace or Agent-managed worktree behavior before sending the request as a normal Plan turn.

#### Scenario: Always-confirm Direct submission
- **WHEN** the confirmation policy is `always` and the user submits an Automatic request
- **THEN** the system SHALL preserve the draft until the user chooses execution options and confirms

#### Scenario: Default Direct submission
- **WHEN** the confirmation policy is `defaults` and the default mode is Direct
- **THEN** the system SHALL begin planning without opening the configuration dialog

#### Scenario: Default scheduled submission
- **WHEN** the confirmation policy is `defaults` and the default mode is scheduled
- **THEN** the system SHALL still require a fresh exact date and time while reusing the other scheduled defaults

#### Scenario: User saves defaults from the dialog
- **WHEN** the user chooses "Set as default and continue"
- **THEN** the reusable selections SHALL be persisted, the absolute date/time SHALL NOT be persisted, and the current request SHALL continue

#### Scenario: User cancels configuration
- **WHEN** the user cancels or saving defaults fails
- **THEN** no plan turn SHALL be sent and the draft, attachments, and file references SHALL remain available

#### Scenario: Automatic start is activated twice
- **WHEN** the same draft is submitted again while its first Automatic admission is still pending or already recorded
- **THEN** the duplicate SHALL be consumed without a second intent, plan turn, or error banner

#### Scenario: User sends new text while Automatic planning is active
- **WHEN** the task already owns a healthy Automatic intent and the submitted content differs from its initiating request
- **THEN** the content SHALL follow the ordinary Agent guidance/queue path and SHALL NOT start another plan pipeline

### Requirement: A matching successful plan continues exactly once
The system SHALL dispatch a build only after a successful `create_plan` result matches the recorded thread plus canonical workspace and reserved relative path, and each thread SHALL have at most one nonterminal Automatic intent. Runtime-derived plan-id casing differences MUST NOT reject the reserved artifact.

#### Scenario: Matching Direct plan succeeds
- **WHEN** the recorded plan completes successfully with Direct execution
- **THEN** the system SHALL save the plan, prepare the existing Direct prompt, and send one Agent turn to the recorded thread using a stable request ID

#### Scenario: Matching scheduled plan succeeds
- **WHEN** the recorded plan completes successfully with scheduled execution and its time remains in the future
- **THEN** the system SHALL create one existing one-shot plan task bound to the source plan and source thread and SHALL NOT send an immediate build turn

#### Scenario: Plan asks for clarification
- **WHEN** the plan turn pauses for structured user input
- **THEN** the Automatic intent SHALL remain pending and SHALL NOT dispatch a build

#### Scenario: Plan identity does not match
- **WHEN** an old or unrelated `create_plan` result is observed
- **THEN** the Automatic intent SHALL remain unexecuted

#### Scenario: Runtime plan id uses different path casing
- **WHEN** `create_plan` returns the recorded workspace and reserved relative path but its derived plan id differs only by runtime normalization
- **THEN** the result SHALL be treated as the matching plan

### Requirement: Automatic intent recovery is durable and fail closed
The system SHALL persist a bounded, versioned Automatic intent registry, reconcile pending intents after task switches or app restarts without selecting another task, and SHALL fail closed when safe dispatch cannot be proven.

#### Scenario: Renderer restarts before Direct dispatch
- **WHEN** the matching plan already completed and the app restarts
- **THEN** recovery SHALL submit or reconcile the Direct build once using the stored stable request ID

#### Scenario: Renderer restarts around schedule creation
- **WHEN** schedule creation may have completed before the renderer recorded success
- **THEN** recovery SHALL match the existing task by source identity, time, and prepared prompt before attempting creation

#### Scenario: Schedule time expires before planning finishes
- **WHEN** the recorded one-shot time is no longer in the future
- **THEN** the intent SHALL require attention and SHALL NOT run immediately or create an overdue task

#### Scenario: Worktree preflight fails
- **WHEN** the requested worktree cannot resolve a checked-out branch or prepare safely
- **THEN** the intent SHALL require attention and SHALL NOT fall back to current-workspace execution

#### Scenario: Previous turn status remains visible during plan admission
- **WHEN** the admitted plan turn is running but thread detail still exposes a terminal status from another turn
- **THEN** recovery SHALL keep the intent planning and SHALL NOT show a recovery mismatch error

#### Scenario: Matching plan arrives after a stale recovery mismatch
- **WHEN** an older renderer marked the intent as a recovery mismatch and the reserved successful plan result is now present
- **THEN** recovery SHALL clear the stale attention state and continue the build exactly once

#### Scenario: Thread activity long poll waits normally
- **WHEN** the GUI observes thread activity with a bounded server wait
- **THEN** Main SHALL keep the request alive beyond the wait window so normal idle waits do not degrade task recovery

### Requirement: Automatic builds remain Direct-only
Automatic mode SHALL support immediate Direct and scheduled Direct builds only, while Graph remains available solely through existing manual controls.

#### Scenario: Automatic mode is selected while Graph is armed
- **WHEN** the user selects Automatic mode
- **THEN** the next-turn orchestration SHALL switch to Direct and the Automatic configuration SHALL NOT offer Graph
