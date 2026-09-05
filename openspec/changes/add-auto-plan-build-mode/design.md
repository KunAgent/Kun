## Context

The renderer already owns GUI plan drafting, persisted plan artifacts, Direct plan prompt construction, transient per-plan worktree choice, and one-shot scheduled plan builds. The missing behavior is a durable coordinator that captures execution choices before a plan turn and invokes those existing paths only after the exact plan result succeeds. Kun accepts only `agent` and `plan` turn modes, and all dynamic workspace, branch, schedule, and plan content must remain outside its immutable prefix.

## Goals / Non-Goals

**Goals:**

- Add a default-off Code composer mode that sequences one plan turn into one Direct or scheduled build.
- Preserve drafts until configuration is confirmed, support independent Automatic defaults, and keep scheduled wall-clock selection explicit.
- Resume exact pending intents after task switches or renderer restarts without duplicate turns or scheduled tasks.
- Reuse the existing same-thread Direct prompt-managed worktree and GUI schedule paths.

**Non-Goals:**

- Adding an `auto` Kun thread/turn mode, Graph automatic builds, a second worktree coordinator, remote Git operations, or host-side plan lifecycle ownership.
- Changing manual plan-build defaults or the scheduler's execution semantics.

## Decisions

### 1. Keep Automatic as a renderer-only composer intent

The persisted composer selection expands to `agent | plan | auto`, but an Automatic request is submitted to Kun as an ordinary `plan` turn and its continuation as an ordinary Direct `agent` turn. Selecting Automatic also resets the next-turn orchestration to Direct. This keeps runtime contracts, cache partitions, and Graph admission unchanged.

### 2. Store GUI defaults under the existing Laboratory settings envelope

`agents.kun.lab.autoPlanBuild` stores availability, confirmation policy, default execution kind, an independent worktree default, and scheduled provider/model/reasoning/time-zone defaults. Missing fields normalize to disabled, always confirm, Direct, worktree enabled, and inherited schedule selections. The Electron settings schema accepts the block, while GUI-to-Kun config projection deliberately omits it because the runtime does not consume it.

### 3. Use one pre-plan configuration dialog

The dialog keeps the composer draft and attachments untouched until confirmation. Direct submissions need only execution kind and workspace/worktree choice. Scheduled submissions reuse the existing provider/model/reasoning/time-zone and wall-clock validation helpers. "Set as default and continue" saves all reusable choices and switches to defaults mode; it never saves the absolute date/time. Defaults mode skips Direct confirmation, while Scheduled always opens for a fresh exact time.

### 4. Persist exact bounded intents in renderer storage

A versioned registry stores at most 100 newest intents with stable plan/build request IDs, workspace/thread/plan identity, execution selection, optional one-shot schedule draft, status, and timestamps. A task can own only one nonterminal intent. The plan ID is allocated before admission, and the new thread ID is bound immediately after the plan send succeeds.

The coordinator advances only when a successful `create_plan` result matches the intent's workspace, thread, and plan ID. Structured user input leaves it pending; failures, cancellation, disabling the experiment, identity mismatch, expired schedule time, or preparation failures move it to `needs_attention` instead of falling back.

### 5. Reuse target-thread and scheduler idempotency surfaces

Direct dispatch saves and prepares the plan through the existing helper, then sends to the recorded thread with a stable `clientRequestId`. Recovery queries thread detail/state and treats an already admitted matching request as success. Scheduled dispatch uses the existing creation IPC and checks existing tasks for the same plan ID, thread ID, execution time, and prepared prompt before creating, which makes a renderer retry observationally idempotent without changing the scheduler contract.

The coordinator listens to active projections and performs a bounded startup reconciliation over stored intents. It uses target-thread provider APIs and never selects or mutates the user's active task while recovering background work.

### 6. Keep worktree ownership in the existing plan prompt

Both immediate and scheduled Automatic builds pass the captured choice into `preparePlanBuild`. Worktree-enabled Direct prompts retain branch discovery, source-dirty-file preservation, rebase, fast-forward integration, and safe cleanup rules. Scheduled tasks themselves keep `useWorktree: false` so there is no nested worktree lifecycle.

### 7. Fence recovery to the admitted plan turn

The intent snapshots the admitted plan turn id after `waitForRuntimeAdmission` resolves. Recovery treats `latestTurnStatus` as authoritative only when `latestTurnId` is that exact plan turn; a terminal status from an earlier or later turn is stale for the intent and cannot fail it. Existing version-1 intents without a turn id remain pending until their reserved plan result appears.

Plan result identity uses the normalized workspace root and reserved relative path. The runtime-derived `plan_id` is diagnostic rather than authoritative because path casing normalization can make it differ from the renderer's pre-admission id while still referring to the same reserved artifact.

The prior recovery-mismatch `needs_attention` state is retryable: if the matching plan result later appears, the coordinator clears that stale banner and continues exactly once. Other attention states such as expired schedules or Git preparation failures remain fail-closed.

The sidebar thread-activity observer uses a 25-second server wait, so Main gives this long-poll route the same bounded wait-plus-margin timeout policy as model-connection events. This prevents expected long polls from being aborted by the generic GET timeout and keeps background completion state fresh.

### 8. Treat duplicate starts and follow-ups as normal composer input

Starting an Automatic request is serialized by thread/workspace scope before asynchronous plan-path discovery. Repeated activation of the same draft while admission is pending is idempotent and consumes the duplicate UI action without creating another intent or banner.

Each intent stores a bounded deterministic request fingerprint. Once an Automatic intent exists, the same fingerprint is treated as a duplicate submission; a different prompt is sent through the ordinary Agent send path so current-turn queue/guidance behavior remains available. It does not create a second plan pipeline, and the Automatic intent continues to its build after queued work settles.

## Risks / Trade-offs

- [A schedule time can expire while planning] -> Revalidate after `create_plan` and require a new time; never create an overdue task from the pending intent.
- [Renderer crashes between side effect and local completion update] -> Reconcile Direct by stable request ID and Scheduled by exact task identity before retrying.
- [Stored provider/model becomes unavailable] -> Resolve against the current catalog and require attention rather than silently choosing an unrelated build model.
- [Background reconciliation can race live UI projection] -> Serialize dispatch per intent and mark `dispatching` before performing any side effect.
- [Automatic and manual worktree preferences can diverge] -> Keep the settings explicitly independent and project the captured Automatic choice into the generated plan controls only for that plan.

## Migration Plan

1. Add defaults, strict patch schemas, normalization, and runtime-projection regression coverage.
2. Add composer selection/UI and the shared configuration dialog behind the disabled experiment.
3. Add the persisted intent registry, foreground sequencing, and background/startup reconciliation.
4. Add focused and full validation. Rollback hides Automatic mode and ignores/removes only its renderer intent registry; it does not delete plans, scheduled tasks, branches, or worktrees.

## Open Questions

None.
