## 1. Queue State and Contracts

- [x] 1.1 Add a pure safe-restore policy that accepts only messages the composer can faithfully rebuild (pending plain mirrored text or image attachments), preserving stable queue/routing fields.
- [x] 1.2 Add and persist `restoreQueuedMessage(id)` that removes the message by stable id without changing unrelated records or queue order.
- [x] 1.3 Wire restore-to-composer through Workbench and composer props, and project failed/error queue metadata required for visible recovery.

## 2. Harness QueueDock Renderer

- [x] 2.1 Add a dedicated composer `attachedDock` seat so queue UI physically joins the composer and remains separate from floating status overlays.
- [x] 2.2 Replace QueueStrip/hover Portal/reorder/overflow UI with single-row direct and multi-row collapsed/expanded QueueDock disclosure.
- [x] 2.3 Implement restore-to-composer editing, mutation single-flight, failure retention, and paused/failed Retry presentation.
- [x] 2.4 Port Harness geometry into a scoped CSS module, map semantic Kun theme tokens, add all-locale copy, and remove obsolete strip styling/component.

## 3. Verification

- [x] 3.1 Add focused restore/store tests for identity preservation, invalid restores, persistence, and unrelated-row stability.
- [x] 3.2 Replace contradictory strip/popover/reorder tests with reference-derived QueueDock component tests for disclosure, live updates, restore-to-composer editing, action locking, failure states, and accessibility.
- [x] 3.3 Add a deterministic Electron QueueDock smoke covering single/multi disclosure, restore-to-composer edit, failure/retry, 36/28/12/180 geometry, attachment to composer, narrow layout, and light/dark screenshots.
- [x] 3.4 Run focused tests, `npm run typecheck`, `npm run build:kun`, `npm run build`, changed-file ESLint, file-line/OpenSpec/diff checks, and separate existing baseline failures.
- [x] 3.5 Commit, rebase onto latest local `develop`, rerun affected checks, fast-forward merge without overwriting source changes, prove containment, and remove the worktree/branch.

## 4. Multi-row Ordering Follow-up

- [x] 4.1 Wire the existing persisted `reorderQueuedMessage` action through every composer variant to the attached QueueDock.
- [x] 4.2 Add expanded-list drag handles, midpoint before/after drop indicators, keyboard ArrowUp/ArrowDown ordering, and live drag-state cleanup without changing DSH disclosure geometry.
- [x] 4.3 Add focused component/store and Electron smoke coverage for drag, keyboard order, persistence, action locking, collapsed/single states, and race-safe no-ops.
- [x] 4.4 Run validation, commit, rebase onto latest local `develop`, fast-forward merge, prove containment, and remove the worktree/branch.
