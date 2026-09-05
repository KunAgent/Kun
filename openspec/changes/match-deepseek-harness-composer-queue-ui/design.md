## Context

Kun already owns durable renderer-side queued messages, FIFO draining, pause/failure recovery, and explicit mid-turn guidance. The current queue UI, introduced outside OpenSpec, projects only the first item into a detached strip and exposes the full list through a hover/focus Portal with drag reorder and an overflow Edit action. DeepSeek Harness `master@0a53fb55bea101816fa226bb964ae2bed71c343b` instead uses an attached QueueDock: one row is direct, multiple rows collapse behind a total count, editing returns the message to the composer, and the queue remains visible on failure.

The source checkout contains unrelated Startup UI work, so implementation must start from the committed local `develop` HEAD in a separate worktree and touch only queue/composer/OpenSpec/test files.

## Goals / Non-Goals

**Goals:**

- Match the frozen Harness QueueDock hierarchy, geometry, collapse rules, editing workflow, action order, accessibility, theme behavior, and narrow-width containment.
- Preserve Kun's existing FIFO delivery, image/Plan/Graph guidance eligibility, paused/failed recovery, idempotency, frozen model/provider/routing snapshots, and thread-local persistence.
- Make failed queued messages visible and recoverable.
- Let users move later queued messages earlier through direct manipulation without leaving the attached QueueDock.
- Add deterministic component, store, and Electron interaction/visual evidence.

**Non-Goals:**

- Change runtime steering routes, terminal sealing, delivery order, persistence format, send-key preferences, or ordinary busy-turn submission behavior.
- Add DSH's global queue/steer shortcut policy or automatically steer queued messages.
- Add an overflow menu or allow ordering while the list is collapsed, a row is being restored, or another queue mutation is pending.
- Restore unrelated turn-section changes from the reverted historical QueueDock experiment.

## Decisions

### Port the attached dock, not the reverted commit

Rebuild the QueueDock from the frozen Harness source and current Kun contracts. Historical commit `8fbb9885c` is implementation evidence only: it mixed the dock with unrelated message-timeline behavior and was fully reverted. Direct cherry-pick is therefore unsafe.

`FloatingComposerAboveInputStack` gains a dedicated `attachedDock` seat before floating statuses. The queue leaves the absolute hover-status stack, so its bottom edge is physically closed by the composer card and never separated by Todo/Graph/Goal overlays.

### Use Harness single/multiple disclosure semantics

Zero visible rows render nothing. One row renders directly without a count header. Two or more rows start collapsed behind a total-count button and expand inline. Editing or an asynchronous action forces the list open and disables collapse. Emptying the queue resets the next multi-row appearance to collapsed.

Starting/in-flight rows stay hidden because their user item is already owned by an admitted turn. Pending, paused, and failed rows stay visible; safely replayable paused/failed rows expose retry plus removal. Provisional `waitForRuntimeAdmission` failures retain removal but disable retry because their original admission waiter has already settled and replay would otherwise disappear during drain.

### Restore to the composer for editing

Add `restoreQueuedMessage(id)` to the chat store. It is allowed only for pending messages the composer can faithfully rebuild: plain text whose optional `displayText` is absent or exactly mirrors `text`, or image attachments, with no document attachments, file references, extension/write/design/Plan context, or derived structured prompt. The action removes the message by stable id, preserving queue order and the restored payload's frozen model/provider/reasoning/routing fields; the composer appends the text to any existing draft, restores image attachments, and replays the frozen submission settings.

Restore is rejected for missing ids, unsupported payloads, or rows already paused/failed/starting/in-flight. The row stays queued on rejection. There is no inline editor: Edit always returns the message to the composer input, which is then focused for further editing.

### Serialize mutation presentation

The dock keeps one local busy id while Guide/Retry or restore-to-composer Edit operations settle. Collapse and all row mutations are disabled during that window. A failed Guide/Retry keeps the authoritative row; existing store error reporting remains the user notification path. Remove stays synchronous but is disabled while another action owns the dock.

### Reorder expanded queues by stable identity

When two or more visible rows are expanded and no edit/mutation is active, each row exposes a 28px drag handle. HTML drag-over compares the pointer with the target row midpoint to choose `before` or `after`, renders a 2px insertion indicator, and calls the existing persisted `reorderQueuedMessage(sourceId, targetId, position)` action on drop. The queue store remains the single ordering authority; local drag state never mutates a shadow array.

The same handle supports ArrowUp/ArrowDown to move one visible position for keyboard users. Single-row and collapsed queues expose no handle. Dragging is cancelled when queue ownership changes, the source row disappears, a restore begins, or an asynchronous action starts.

### Use Kun semantic tokens with fixed Harness geometry

A CSS module owns the 36px header/row, 28px actions, 10px action spacing, 12px top corners, square bottom, 180px list cap, separators, ellipsis, focus rings, and a 3px tuck beneath the composer top edge. Colors map the Harness tip/border/label semantics to Kun tokens; no literal light-only colors or queue-specific dark branch is introduced.

## Risks / Trade-offs

- [Restoring derived prompts could desynchronize visible and runtime text] → Restrict restore to messages the composer can faithfully rebuild (plain mirrored text or image attachments) and refuse document or structured payloads.
- [A live queue update removes the row being restored] → The row leaves the queue; the composer draft remains intact and editing continues there.
- [A second item arrives during restore] → Interaction state forces the newly multi-row dock open.
- [Long queues grow over the composer] → Cap the list at 180px and scroll only the list.
- [Existing hover/Portal tests encode the regressed design] → Replace them with reference-derived dock tests while adding ordering coverage for the user-requested extension.
- [Dragging races with queue delivery] → Address rows by stable ids, disable drag during active mutations, clear transient drag state on live retirement, and let no-op/missing-id store operations safely converge.
- [Failed items contain long error text] → Keep the row at 36px, show a compact failure indicator/status and expose the full error through accessible title text.
- [A provisional admission failure is retried after its waiter settled] → Disable unsafe retry, retain the row, and direct the user to remove and resubmit.

## Migration Plan

No persisted migration is required. Existing queued records are projected into the new dock immediately. Rollback restores the previous renderer components; store/runtime queue data remains compatible.

## Open Questions

None. The reference commit, geometry, disclosure behavior, restore safety boundary, and preservation of current Kun delivery semantics are fixed.
