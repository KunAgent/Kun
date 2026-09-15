## 1. Feedback Contracts and Privacy Fixtures

- [x] 1.1 Add versioned feedback event, aggregate, diagnostics, and opt-in configuration contracts for `retrieved`, `confirmed`, and `corrected` events; verify contract tests reject unknown fields, unbounded identities, content, queries, paths, credentials, and conflicting event-id replays.
- [x] 1.2 Add shared confirm/correct request and result contracts with stable operation ids, same-scope version links, and bounded errors; verify schema tests cover unauthorized, cross-scope, inactive, and retry inputs.
- [x] 1.3 Add anonymous deterministic Memory/feedback fixtures for repeated retrieval, explicit confirmation, correction, inactive records, and scope violations; verify fixture validation and snapshot hashes are stable.

## 2. Ledger Persistence and Rebuildable Aggregates

- [x] 2.1 Implement a local append-only feedback ledger with serialized writes and same-id/same-payload idempotency; verify restart, concurrent append, duplicate replay, and conflicting replay tests pass.
- [x] 2.2 Implement the rebuildable per-Memory aggregate projection without writing canonical Memory records; verify counts and last-event timestamps rebuild identically while canonical content and freshness timestamps remain byte-for-byte unchanged.
- [x] 2.3 Add bounded ledger diagnostics and recovery for malformed tails, invalid interior events, missing projections, and write failures; verify valid prefixes remain usable and canonical Memory CRUD/retrieval stays available.
- [x] 2.4 Add bounded retrieval-event segments and atomic aggregate checkpoints while retaining explicit confirmation/correction audit events; verify crash-before/after-checkpoint recovery produces equivalent aggregates and no duplicate counts.

## 3. Explicit Confirmation and Versioned Correction

- [x] 3.1 Add explicit confirmation to the local Memory service with authorization, lifecycle, opt-in, and stable event identity checks; verify search, preview, model continuation, and repeated retrieval never create confirmation events.
- [x] 3.2 Add versioned correction that creates one same-scope replacement, sets `supersedes`, marks the old record superseded, and preserves old content/evidence; verify active retrieval exposes only the new version.
- [x] 3.3 Add a durable correction receipt and idempotent reconciliation across canonical mutation and feedback append; verify retries at every interruption point return the same new Memory id and one correction event.

## 4. Manager Ownership and Remote Parity

- [x] 4.1 Add Manager shared-data RPC operations for feedback append, aggregate/diagnostics reads, confirmation, and correction; verify remote clients cannot create private competing ledgers.
- [x] 4.2 Wire hybrid/local and Manager-backed stores to one feedback contract; verify local and remote conformance suites produce identical events, aggregates, correction versions, errors, and degradation states.
- [x] 4.3 Redact feedback diagnostics through the existing bounded-reason policy; verify Windows, UNC, POSIX, file-URL, credential, content, and query samples cannot leak while module/platform/ABI diagnostics remain actionable.

## 5. Actual-Injection Feedback Capture

- [x] 5.1 Add one asynchronous best-effort `recordRetrieved` helper that accepts only final selected ids plus stable bounded turn identity; verify it never changes retrieval results, traces, formatted context, or canonical Memory timestamps.
- [x] 5.2 Invoke the helper after final Memory context assembly in the main agent loop, Cursor SDK runtime, and Agent SDK runtime; verify parity tests record only records actually included after record and prompt budgets.
- [x] 5.3 Verify GUI search, list, diagnostics, evaluator runs, rejected candidates, and prompt-budget omissions emit no production retrieval events, including during SQLite fallback and stale recovery.
- [x] 5.4 Inject disabled and failing feedback adapters into all three runtime surfaces; verify selected ids, order, trace, context bytes, model request, and turn outcome match the no-feedback baseline.

## 6. User-Facing Confirmation and Correction

- [x] 6.1 Add HTTP, main/preload, and renderer adapters for explicit confirmation and correction using the shared contracts; verify authorization, scope, stable operation id, and Manager ownership are preserved end to end.
- [x] 6.2 Add clearly labeled Confirm and Correct actions to Memory settings without changing ordinary metadata editing; verify correction shows the new active version and retains the superseded record in audit views.
- [x] 6.3 Add feedback capability and bounded degradation status to Memory diagnostics while keeping collection disabled by default; verify disabling collection stops new retrieval/confirmation events and does not disable explicit canonical correction.

## 7. Offline Feedback-Ranking Decision

- [x] 7.1 Implement a deterministic evaluator wrapper over the unchanged lexical foundation using separately traced importance, confidence, freshness, `log1p(retrievalCount)`, confirmation, and correction features; verify no evaluator code is imported by production retrieval.
- [x] 7.2 Pre-register bounded candidate formulas, relevance/uncertainty/safety/privacy/resource gates, anonymous dev/holdout partitions, and bootstrap lower-bound rules before reading holdout results; verify the manifest and fixture hashes are frozen.
- [ ] 7.3 Run development evaluation, freeze one candidate only if every development gate passes, then run holdout at most once; publish traces and a reproducible go/no-go decision without modifying production weights or adding a dormant ranking flag.

## 8. Validation and Stage Closeout

- [ ] 8.1 Run focused feedback, Memory store, Manager RPC, HTTP, renderer, and three-runtime parity tests plus `npm run build:kun`, `npm run typecheck`, `npm run build`, changed-file ESLint, `npm run check:file-lines`, and `openspec validate add-kun-memory-feedback-evolution --type change --strict --no-interactive`; record any unrelated baseline failures separately.
- [ ] 8.2 Update Memory architecture/privacy documentation and `D:\learning\Review_md\kun-memory-roadmap.md` with event semantics, opt-in behavior, correction versioning, evaluation outcome, commit evidence, and the explicit condition for any later P3-B production-ranking proposal.
