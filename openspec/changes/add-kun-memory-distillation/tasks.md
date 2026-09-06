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
- [x] 3.6 Commit the P1-A branch and prepare PR evidence; keep any local P1-B work stacked and deliver it only after P1-A merges

## 4. P1-B runtime coordination

- [x] 4.1 Add an opt-in setting that defaults distillation off and does not weaken existing Memory approval policy
- [x] 4.2 Schedule at most one bounded extraction after a non-empty successful turn is durably completed
- [x] 4.3 Reuse the initiating Kun model route with no tools, deterministic JSON, input/output/candidate caps, timeout, and sanitized failure diagnostics
- [x] 4.4 Derive scope from host context, retrieve authorized active comparison records, and reject arbitrary model-selected targets
- [x] 4.5 Keep distillation asynchronous so failure never delays, fails, or reverses the completed turn

## 5. P1-B approval and persistence

- [x] 5.1 Add a versioned pending-candidate store with thread/turn/candidate fingerprints and restart recovery
- [x] 5.2 Present candidate content, type, importance, sources, proposed action, and target independently in the approval UI
- [x] 5.3 Permit MemoryStore create/update/supersede only after allow; deny, timeout, expiry, and pre-write withdrawal remain terminal non-writing outcomes
- [x] 5.4 Preserve sources and `authority=reference` for every approved mutation, including inference-backed candidates
- [x] 5.5 Prevent replay or restart from duplicating pending candidates or reopening terminal outcomes
- [x] 5.6 Skip every internal `messageSource` and bind source ids to thread/turn identity
- [x] 5.7 Revalidate target versions and exact duplicates at allow time with a terminal conflicted outcome
- [x] 5.8 Persist an apply receipt and reconcile interrupted writes against canonical Memory on restart
- [x] 5.9 Make pending-state mutations copy-on-write and cover failed durable writes
- [x] 5.10 Track in-flight distillation, reject work during shutdown, and settle it before stores close

- [x] 5.11 Route the shared candidate ledger through Service Manager and preserve terminal decisions across runtime reconnects
- [x] 5.12 Commit version/lifecycle/duplicate validation with canonical Memory mutation under one owner queue; detect same-millisecond edits using record fingerprints

## 6. P1-B acceptance and delivery

- [x] 6.1 Test completed/failed/aborted/empty turns, extractor timeout/error/invalid output, and turn-status isolation
- [x] 6.1.1 Make P1-B workspace fixtures platform-neutral and verify them on Linux-compatible paths
- [x] 6.2 Test allow, deny, timeout, expiry, withdrawal, update, supersede, scope isolation, restart, and replay flows
- [x] 6.3 Verify zero pre-approval writes, post-rejection writes, scope leaks, transient writes, authority elevations, replay duplicates, and distillation-caused turn failures
- [ ] 6.4 Run focused and full tests, typecheck, build, lint, file-lines, OpenSpec strict, and UI acceptance
  - 2026-09-03: P1-B focused Kun tests (19/19), focused desktop settings/UI tests (91/91), root typecheck, Kun/root build, tracked and changed-file line limits, diff check, and OpenSpec strict validation pass. Full lint reaches the unchanged upstream `BackgroundShellOverlay.tsx` `no-control-regex` baseline error; full tests and interactive UI acceptance remain delegated to PR CI/review, so this task is intentionally not marked complete.
  - 2026-09-05: Rebased P1-B onto `upstream/develop` at `d71cc52c` (including merged #1278). Removed redundant candidate-request wrappers after the combined runtime service reached 702 lines; it is now 691 lines. With independent lockfile-installed dependencies, Kun Memory/queue focused tests pass (83/83), desktop/settings/IPC focused tests pass (150/150, including five new request-routing regressions), and root typecheck, production build, full lint (0 errors, 30 warnings), production dependency audit, file-lines, diff check, and OpenSpec strict pass. Release-workflow tests pass (8/8) with Git Bash on the child process PATH; the initial Windows WSL Bash selection failed. Full-suite, cross-platform packaging, and interactive UI evidence remain pending on the updated PR and are not marked passed.
  - 2026-09-06 maintainer repair: moved candidate operations to Service Manager and added atomic canonical commits with record fingerprints. Node 22 focused runtime/Manager/SQLite tests pass (138/138), desktop settings/IPC tests pass (119/119), and typecheck, build, lint (0 errors, 30 existing warnings), file-lines, and OpenSpec strict pass. Full tests, interactive UI acceptance, and new-head CI are being recorded separately; no new-head CI success is claimed here.
- [x] 6.5 Record model budget, candidate quality, source completeness, approval behavior, known limits, and CI results in the P1-B PR
- [ ] 6.6 Archive the OpenSpec change only after P1-B is merged and all acceptance evidence is complete
