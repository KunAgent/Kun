# Rooms implementation status

Rooms V1 is **not available**. The modules in `kun/src/rooms` are the first
M0 foundation increment of the approved implementation plan, not a shipped
chatroom feature. No GUI route, HTTP endpoint, runtime tool, or background
execution has been enabled by this increment.

## Implemented primitives

- Strict room/member/repository/message contracts with stable identities,
  explicit repository allowlists, and bounded input sizes.
- Separate task, attempt, amendment, delivery, and review contracts.
- Host-evidence-gated business state transitions. Cancellation requests cannot
  be presented as stopped execution, and acceptance does not apply changes.
- Deterministic addressing and repository selection. Addressing is not an
  execution authorization; arbitrary message text is never used to choose a
  writable directory.
- A Manager-owned commit-journal prototype with checksums, exclusive revision
  creation, durability, command fingerprints, revision conflict detection,
  and fail-closed corruption handling.
- A dispatch reconciliation primitive that preserves the original thread and
  request identities across admission/acknowledgement uncertainty.
- Git observation, pinned committed-baseline worktree creation, and read-only
  apply preflight guards. There is no implementation of applying deliveries.

## Important integration requirements

The primitives are deliberately not registered in the running application.
Their ports must be implemented before they can be used by user requests.

1. Bind persistence and dispatch to the Service Manager ownership and fencing
   boundary. The journal callback is not a filesystem sandbox and does not
   provide cross-process arbitration on its own.
2. Replace the prototype journal's full replay per append with the planned
   bounded segmented journal, recovery checkpoints, and SQLite query index.
   Implement damaged-tail recovery without discarding committed records.
   POSIX commits sync directory ancestors as well as commit files. Windows
   currently syncs files only; directory-entry power-loss durability is not
   established and must be validated before enabling durable message ACKs.
3. Connect durable room dispatch intents to the real ThreadStore/TurnService
   queue. The admission adapter must provide durable idempotent thread creation
   and request lookup, not a best-effort in-memory cache.
4. Implement safe capacity suspension/resumption for approvals and user input,
   preserving process ownership, cancellation, and continuation evidence.
5. Validate canonical paths and authorized destinations before worktree
   creation, and enforce actual ToolHost/SDK scopes. Worktrees are not sandboxes.
6. Implement immutable delivery capture, pinned review materialization,
   integration worktree conflict handling, and explicitly authorized apply.
7. Add task provenance and controls across Code/API paths, with retention pins
   preventing ordinary thread cleanup from deleting unfinished deliveries.
8. Implement room API/SSE, the GUI, full routing/clarification, attachments,
   project agreements, collaborative review, and bounded rework.
9. Complete M0 exit tests and M1-M4 acceptance, restart/fault injection,
   pagination/performance, and packaged cross-platform smoke coverage.

## Verification of this increment

Run from an isolated checkout using a supported Node version:

```bash
cd kun
./node_modules/.bin/vitest run src/rooms
npm run typecheck
cd ..
npm run build:kun
./node_modules/.bin/eslint kun/src/contracts/rooms.ts \
  kun/src/contracts/room-tasks.ts kun/src/contracts/room-deliveries.ts \
  kun/src/rooms
npm run check:file-lines
git diff --check
```

The implementation passed 29 tests across four files, Kun typecheck,
Kun build, and scoped lint on macOS with Node 25.2.1. Tests use temporary Git
repositories and fake admission ports; they do **not** establish a real Runtime
or GUI execution guarantee. Full application tests, performance targets,
Windows/Linux execution, and A01-A30 release acceptance remain unverified.
