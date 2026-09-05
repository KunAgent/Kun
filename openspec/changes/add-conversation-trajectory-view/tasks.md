## 1. Contracts and Compact Storage

- [x] 1.1 Add versioned trajectory request/tool/page/summary/detail contracts and stable round/request/step correlation fields.
- [x] 1.2 Implement always-on compact lifecycle recording, first-content timing, terminal/interrupted recovery, and bounded progress checkpoints.
- [x] 1.3 Implement sanitized Prompt Manifests and SHA-256/Brotli content-addressed blobs with truncation and private permissions.
- [x] 1.4 Implement detail budgets, mark-and-sweep deletion, and schema-v1 trace compatibility without new durable raw payloads.

## 2. Query Surface

- [x] 2.1 Implement trajectory projection/query service with paging, filtering, bounded search, Session item/tool joins, and summary aggregation.
- [x] 2.2 Add authenticated trajectory page, summary, and section-detail routes plus compatibility projection for existing model-request clients.
- [x] 2.3 Wire contracts through runtime composition, deletion lifecycle, main/preload allowlists, and the renderer runtime client.

## 3. Conversation Trajectory UI

- [x] 3.1 Add bounded per-thread trajectory UI state and the title-bar chat/trajectory toggle with running/failure/accessibility states.
- [x] 3.2 Build the trajectory toolbar, metrics strip, three-lane timeline, filters, bounded search, and display-mode controls.
- [x] 3.3 Build the chronological virtualized Turn/Step ledger with paging, stable prepend anchoring, live follow, and new-record affordance.
- [x] 3.4 Build responsive LLM/tool inspectors for overview, input/arguments, output/result, usage, timing, and normalized raw detail.
- [x] 3.5 Keep chat/composer state mounted, migrate Agent Perspective primitives, remove its right-panel contribution, and handle legacy layout IDs.
- [x] 3.6 Add localized copy, loading/empty/incomplete/evicted/error/interrupted states, themes, keyboard behavior, and reduced motion.

## 4. Verification and Integration

- [x] 4.1 Add focused storage, security, lifecycle, API, projector, and renderer behavior/virtualization tests.
- [x] 4.2 Run focused tests, typecheck, Kun build, full tests/build/lint/file-line/diff checks and address introduced failures.
- [x] 4.3 Commit the completed change, rebase onto the latest local develop if needed, resolve conflicts with tests, fast-forward merge, and safely remove the worktree/branch.
