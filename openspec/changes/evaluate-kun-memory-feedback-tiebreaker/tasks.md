## 1. Versioned Contracts And Pre-registration

- [x] 1.1 Add strict schemas for the P3-B fixture, manifest, calibration report, decision plan, candidate lock, and evidence artifacts; verify unknown fields, unsupported versions, duplicate ids, and invalid hashes are rejected by focused contract tests.
- [x] 1.2 Define the baseline-only adjacent-gap calibration procedure, including exact-tie/no-rerank controls, finite grid-size ceiling, boundary inclusivity, group construction, and maximum reorder window; verify a deterministic fixture produces the expected ordered grid.
- [x] 1.3 Define the pre-registered candidate family and selection rule for foundation-only, confirmation-aware, and confirmation-plus-correction-aware comparators; verify retrieval frequency is present only as a shadow trace field and cannot affect comparator output.
- [x] 1.4 Define local-benefit, global non-regression, bootstrap, safety, privacy, determinism, and resource gates in the versioned plan before candidate holdout scoring; verify the plan hash changes when any gate or candidate rule changes.

## 2. Anonymous Decision Data

- [x] 2.1 Create a synthetic Memory and feedback corpus with near-tie confirmation, active corrected replacement, high-frequency-unconfirmed, no-feedback, wide-gap, no-result, scope, and lifecycle strata; verify every record and event passes the production contracts without using real user data.
- [x] 2.2 Add development and holdout queries with expected sets, preferred/unpreferred pairs, explicit hard negatives, stratum labels, and human-readable rationales; verify exact quotas and referenced ids through the fixture validator.
- [x] 2.3 Reject normalized duplicate and near-duplicate cases across splits and reject ambiguous labels or invalid preference targets; verify focused negative fixtures fail before retrieval executes.
- [x] 2.4 Publish the versioned manifest and SHA-256 checksums for all frozen inputs; verify a one-byte fixture change invalidates the manifest.

## 3. Offline Candidate Evaluation

- [x] 3.1 Reproduce the unchanged post-#1308 lexical foundation ranking from authorized active fixture records and emit adjacent foundation-score gaps; verify selected ids and scores match direct foundation retrieval for every case.
- [x] 3.2 Implement deterministic near-tie grouping for every declared boundary with foundation-score and stable-id fallback order; verify exact-boundary, multi-record group, and wide-gap behavior.
- [x] 3.3 Implement confirmation-aware and confirmation-plus-correction-aware evaluator comparators that reorder only admitted near-tie candidates; verify they cannot add candidates, fill abstentions, cross budgets, or restore inactive records.
- [x] 3.4 Emit retrieval count and last-retrieved time as bounded shadow features; verify changing only retrieval frequency leaves every candidate order and selected id byte-for-byte unchanged.
- [x] 3.5 Enforce evaluator-only imports and offline execution; verify production Memory, Manager, server, runtime, and renderer modules do not import P3-B evaluator modules and an instrumented network attempt count remains zero.

## 4. Metrics, Locking, And Holdout Discipline

- [x] 4.1 Report near-tie pair-ordering accuracy separately from Recall@K, Precision@K, MRR, abstention, explicit hard-negative selection, and authorization violations; verify metric denominators and per-case deltas on hand-calculated fixtures.
- [x] 4.2 Add deterministic paired-bootstrap intervals using the locked seed, resample count, confidence level, and unit; verify repeated runs produce identical intervals and lower-bound results.
- [x] 4.3 Run the complete finite grid on development data and write a calibration report containing every evaluated configuration; verify configuration ordering and selected ids are reproducible.
- [x] 4.4 Apply the pre-registered selection rule and write one candidate lock containing artifact hashes, evaluator identity, selected candidate, gates, seed, and resource ceilings; verify tampering with any dependency invalidates the lock.
- [x] 4.5 Prevent holdout scoring without a valid lock and prevent overwriting completed holdout evidence for the same decision version; verify rejected attempts emit no holdout metrics or per-case results.
- [x] 4.6 Close v1 at development no-go after auditing holdout integrity: preserve the historical output as non-decision-grade, retire the v1 runner, and prohibit rerunning this version. This is an explicit deviation from the originally planned holdout run, not a claim that holdout was run or passed; verify the final decision and limitations are documented without relying on holdout metrics.

## 5. Safety, Privacy, And Resource Coverage

- [x] 5.1 Add scope, authority, disabled, deleted, expired, future-valid, and superseded hard-negative tests; verify every authorization or lifecycle violation forces no-go with zero tolerance.
- [x] 5.2 Add no-result and positive-relevance tests; verify feedback candidates preserve lexical abstention and never fill the result budget with unrelated records.
- [x] 5.3 Add privacy tests for query text, Memory content, source excerpts, credentials, Windows/UNC/POSIX/file URLs, and oversized diagnostics; verify traces retain only bounded synthetic ids, numeric features, and safe evaluator metadata.
- [x] 5.4 Add deterministic replay and serialization tests across supported runtime environments; verify selected ids, numeric scores within tolerance, metrics, hashes, and decisions remain stable.
- [x] 5.5 Measure evaluation duration, trace count, and serialized artifact bytes against pre-registered ceilings; verify a synthetic over-limit candidate fails the resource gate without truncating decision-critical evidence.

## 6. Baseline Synchronization And Documentation

Closeout checkpoint (2026-09-23): the branch is rebased on
`upstream/develop@65f6a55c4`. The frozen development grid has no eligible
feedback candidate. The holdout audit found repeated temporary-directory scoring
and unmeasured gates; the historical output is preserved but is not decision-grade,
and the v1 runner now rejects every attempt. The contributor closes this version
at development no-go without claiming a holdout result. Production ranking and
all frozen v1 inputs remain unchanged.

Review hardening: tasks 4.4/4.5 now additionally cover recomputed gate flags,
complete grid validation, exclusive evidence-file reservation, interruption and
concurrent execution rejection, and binding final output to locked development.
Correction integration now covers real service events through compaction/restart.
The frozen fixtures and lock are unchanged; label concerns and holdout-label
exposure are recorded in `development-review.md`, not silently resolved.

- [x] 6.1 Fetch the latest `upstream/develop`, rebase this branch, and verify the final diff contains the P3-B evaluation capability plus the required P3-A canonical spec synchronization/archive closeout, with no importer or production-ranking changes.
- [x] 6.2 Document the calibration method, candidate identities, local/global metrics, privacy model, resource results, and the development no-go; state that no decision-grade holdout result exists, production integration requires a separate passed decision, and P3-A infrastructure is retained.
- [x] 6.3 Update `D:\learning\Review_md\kun-memory-roadmap.md` and create a stage note under `D:\learning\Review_md\codex`; record the commit series, checks, immutable development-input hashes, historical holdout execution limitation, no-go disposition, and remaining P4-A work.

## 7. Validation And Delivery

- [x] 7.1 Run the focused P3-B contract, fixture, evaluator, safety, privacy, determinism, and workflow tests; verify all new cases pass.
- [x] 7.2 Run the existing Kun Memory focused suites, `npm run build:kun`, `npm run typecheck`, `npm run build`, `npm run lint`, and `npm run check:file-lines`; separate any pre-existing baseline failures from change-introduced failures.
- [x] 7.3 Run strict OpenSpec validation and `git diff --check`; verify every authored text file remains within 700 physical lines.
- [x] 7.4 Commit each meaningful artifact group with Angular-style messages and push the preparation branch to SunwardL; keep the formal PR closed until the decision and documentation tasks are complete, and do not open a separate P3-A closeout PR.
- [x] 7.5 Create one PR targeting `KunAgent/Kun:develop` with the P3-B evaluation and P3-A spec/archive closeout, including Summary, Changes, Tests, decision outcome, evidence hashes, and the unchanged-production-ranking statement; verify PR #1339 uses base `develop` and head `SunwardL:codex/prepare-memory-feedback-tiebreaker`.
