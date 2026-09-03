## 1. P1-A specification and contracts

- [x] 1.1 Create the `add-kun-memory-distillation` change and define the P1-A/P1-B delivery boundary
- [x] 1.2 Specify strict candidates, safety skips, deterministic decisions, host-owned scope, bounded model use, and per-candidate approval semantics
- [x] 1.3 Document the single-runtime design, model/cost limits, post-persistence trigger, restart behavior, replay idempotency, and evaluation gates
- [x] 1.4 Strictly validate the complete OpenSpec change

## 2. P1-A candidate core

- [x] 2.1 Add a strict bounded `MemoryCandidate` and extraction-envelope contract using current Memory V2 types and sources
- [x] 2.2 Add deterministic normalization for content, tags, sources, comparisons, and stable candidate fingerprints
- [x] 2.3 Add conservative credential and transient-request detection plus the `0.6` confidence gate
- [x] 2.4 Add the pure `create`, `update`, `supersede`, or `skip` decision function with authorized active-target validation
- [x] 2.5 Export the new contracts and pure Memory module without wiring production lifecycle or persistence

## 3. P1-A fixtures and verification

- [x] 3.1 Add anonymous English and Chinese fixtures for facts, preferences, decisions, transient requests, low confidence, credentials, duplicates, updates, and conflicts
- [x] 3.2 Test strict bounds, normalization, safety precedence, all decision actions, target validation, deterministic ordering, and source preservation
- [x] 3.3 Add a deterministic evaluator for decision accuracy, unsafe non-skip decisions, duplicate creates, and source completeness
- [x] 3.4 Run focused tests, Kun build/typecheck, lint, file-lines, diff check, and OpenSpec strict validation
  - 2026-09-03: P1-A focused tests (23/23), all Kun Memory tests (36/36), Kun/root typecheck, Kun/root build, changed-file ESLint, tracked file-lines, diff check, and OpenSpec strict validation pass. Full repository lint retains one unrelated `no-control-regex` error in unchanged `BackgroundShellOverlay.tsx`; a local full test attempt exceeded 15 minutes without returning a result and was stopped, so neither is recorded as passing.
  - 2026-09-04 maintainer review: host-owned evidence binding, future-time rejection, credential/transient hardening, and empty-evaluation rejection are covered by 28/28 focused tests. All Kun Memory tests pass (45/45), as do root/Kun typecheck, `build:kun`, the full production build, full lint with zero errors, tracked file-lines, diff check, and OpenSpec strict validation.
- [x] 3.5 Confirm the P1-A diff has no TurnEnd, settings, approval UI, model-call, or MemoryStore integration
- [x] 3.6 Commit the P1-A branch and prepare PR evidence; do not begin P1-B before P1-A merges

## 4. P1-B runtime coordination

- [ ] 4.1 Add an opt-in setting that defaults distillation off and does not weaken existing Memory approval policy
- [ ] 4.2 Schedule at most one bounded extraction after a non-empty successful turn is durably completed
- [ ] 4.3 Reuse the initiating Kun model route with no tools, deterministic JSON, input/output/candidate caps, timeout, and sanitized failure diagnostics
- [ ] 4.4 Derive scope from host context, retrieve authorized active comparison records, and reject arbitrary model-selected targets
- [ ] 4.5 Keep distillation asynchronous so failure never delays, fails, or reverses the completed turn

## 5. P1-B approval and persistence

- [ ] 5.1 Add a versioned pending-candidate store with thread/turn/candidate fingerprints and restart recovery
- [ ] 5.2 Present candidate content, type, importance, sources, proposed action, and target independently in the approval UI
- [ ] 5.3 Permit MemoryStore create/update/supersede only after allow; deny, timeout, expiry, and pre-write withdrawal remain terminal non-writing outcomes
- [ ] 5.4 Preserve sources and `authority=reference` for every approved mutation, including inference-backed candidates
- [ ] 5.5 Prevent replay or restart from duplicating pending candidates or reopening terminal outcomes

## 6. P1-B acceptance and delivery

- [ ] 6.1 Test completed/failed/aborted/empty turns, extractor timeout/error/invalid output, and turn-status isolation
- [ ] 6.2 Test allow, deny, timeout, expiry, withdrawal, update, supersede, scope isolation, restart, and replay flows
- [ ] 6.3 Verify zero pre-approval writes, post-rejection writes, scope leaks, transient writes, authority elevations, replay duplicates, and distillation-caused turn failures
- [ ] 6.4 Run focused and full tests, typecheck, build, lint, file-lines, OpenSpec strict, and UI acceptance
- [ ] 6.5 Record model budget, candidate quality, source completeness, approval behavior, known limits, and CI results in the P1-B PR
- [ ] 6.6 Archive the OpenSpec change only after P1-B is merged and all acceptance evidence is complete
