## Why

Creating a GUI plan and then choosing how to build it is currently a manual two-step workflow. Users who repeatedly want the same safe execution policy need a first-class way to submit one request, retain the generated plan, and automatically continue with a Direct or one-shot scheduled build without duplicating the existing plan, worktree, or scheduler lifecycles.

## What Changes

- Add a default-off Laboratory experiment that exposes a GUI-only Automatic composer mode alongside Agent and Plan.
- Let an Automatic submission choose Direct or scheduled execution and current-workspace or Agent-managed worktree behavior before the plan turn starts.
- Persist independent Automatic-mode defaults, including scheduled model defaults, while always requiring an exact date and time for scheduled submissions.
- Continue a successful matching `create_plan` result into the existing Direct plan-build prompt or one-shot plan scheduling path.
- Persist bounded per-thread automation intents so task switches and app restarts can reconcile without duplicate build turns or scheduled tasks.
- Keep Graph, Kun thread modes, the immutable prompt prefix, manual plan defaults, and existing worktree/scheduler ownership unchanged.

## Capabilities

### New Capabilities

- `automatic-plan-build`: Laboratory availability, composer interaction, defaults, plan-to-build sequencing, safe recovery, and failure behavior for Automatic plan builds.

### Modified Capabilities

None.

## Impact

- Shared app settings types, defaults, normalization, IPC validation, and GUI-to-Kun config projection.
- Renderer composer mode persistence, Laboratory settings, plan dialogs/controllers, background recovery, and localization.
- Existing GUI plan preparation, prompt-managed worktree, scheduled-task IPC, and target-thread send APIs are reused rather than replaced.
- Focused settings, renderer, plan-build, scheduling, recovery, and regression tests.
