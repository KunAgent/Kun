## 1. Settings And Contracts

- [x] 1.1 Add Automatic plan-build settings types, defaults, nested merge/normalization, and exports.
- [x] 1.2 Accept a strict Automatic Laboratory patch over settings IPC while omitting GUI-only fields from Kun runtime config.
- [x] 1.3 Add settings default, migration, IPC, and runtime-projection tests.

## 2. Composer And Configuration UI

- [x] 2.1 Extend renderer composer selection and per-thread persistence with the GUI-only `auto` mode.
- [x] 2.2 Gate the Automatic menu item, placeholder, badge, and Direct orchestration behavior behind the Laboratory switch.
- [x] 2.3 Build the unified Automatic configuration dialog with Direct/scheduled, worktree, schedule validation, use-once, and save-default actions.
- [x] 2.4 Add the Automatic Laboratory settings panel and localized strings for all shipped locales.
- [x] 2.5 Add focused composer, dialog, settings, and accessibility tests.

## 3. Durable Automatic Orchestration

- [x] 3.1 Add a versioned bounded Automatic intent registry with identity, status, and strict normalization tests.
- [x] 3.2 Start Automatic plan turns without clearing the draft before confirmation and bind new-thread identity after admission.
- [x] 3.3 Reconcile exact successful plan results into existing Direct prompt preparation and target-thread idempotent dispatch.
- [x] 3.4 Reconcile scheduled intents through existing one-shot task creation with exact duplicate detection and overdue validation.
- [x] 3.5 Add task-switch/startup recovery, single-intent serialization, disabled-feature cancellation, and needs-attention behavior.
- [x] 3.6 Add sequencing, failure, stale-result, Direct/worktree, scheduled, restart, and idempotency tests.

## 4. Documentation And Validation

- [x] 4.1 Update architecture/agent documentation for renderer-only Automatic mode and recovery boundaries.
- [x] 4.2 Run focused tests, build:kun, typecheck, full tests, build, lint, file-line gate, and diff check.
- [x] 4.3 Smoke-test Direct/scheduled defaults, worktree/current workspace, task switch, restart, overdue time, and fail-closed errors.

## 5. Git Delivery

- [x] 5.1 Commit the implementation on `codex/add-auto-plan-build-mode` with Angular-style messages.
- [x] 5.2 Rebase onto the latest local `develop`, resolve conflicts semantically, and rerun affected validation.
- [x] 5.3 Fast-forward merge into local `develop`, verify ancestry and smoke checks, then non-force remove the worktree and delete the feature branch.

## 6. Recovery Reliability Fixes

- [x] 6.1 Persist the admitted plan turn id and ignore terminal status from unrelated turns during reconciliation.
- [x] 6.2 Match plan results by canonical workspace/reserved path and self-heal the legacy recovery-mismatch attention state.
- [x] 6.3 Keep thread-activity long polls alive through their server wait window and add timeout regression coverage.
- [x] 6.4 Add end-to-end recovery race tests and rerun focused validation, typecheck, build, lint, file-line gate, and diff check.

## 7. Duplicate Submission And Follow-up Routing

- [x] 7.1 Serialize Automatic starts by thread/workspace scope and persist a bounded request fingerprint.
- [x] 7.2 Consume duplicate activation idempotently and route distinct in-flight follow-ups through ordinary Agent send/queue behavior.
- [x] 7.3 Add duplicate-click and follow-up regression tests, then rerun focused validation and builds.
