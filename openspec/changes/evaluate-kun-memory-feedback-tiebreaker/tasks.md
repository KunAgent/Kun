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
- [ ] 4.6 After independent review confirms the lock and frozen inputs, run holdout exactly once and publish immutable go/no-go evidence; verify the result applies every local-benefit, global, uncertainty, safety, privacy, determinism, and resource gate without post-hoc changes.

## 5. Safety, Privacy, And Resource Coverage

- [x] 5.1 Add scope, authority, disabled, deleted, expired, future-valid, and superseded hard-negative tests; verify every authorization or lifecycle violation forces no-go with zero tolerance.
- [x] 5.2 Add no-result and positive-relevance tests; verify feedback candidates preserve lexical abstention and never fill the result budget with unrelated records.
- [ ] 5.3 Add privacy tests for query text, Memory content, source excerpts, credentials, Windows/UNC/POSIX/file URLs, and oversized diagnostics; verify traces retain only bounded synthetic ids, numeric features, and safe evaluator metadata.
- [ ] 5.4 Add deterministic replay and serialization tests across supported runtime environments; verify selected ids, numeric scores within tolerance, metrics, hashes, and decisions remain stable.
- [ ] 5.5 Measure evaluation duration, trace count, and serialized artifact bytes against pre-registered ceilings; verify a synthetic over-limit candidate fails the resource gate without truncating decision-critical evidence.

## 6. Baseline Synchronization And Documentation

- [ ] 6.1 After #1324 and its P3-A OpenSpec closeout are merged, fetch the latest `upstream/develop`, rebase this branch, and verify the diff contains only the P3-B evaluation capability and artifacts with no importer or production-ranking changes.
- [ ] 6.2 Document the calibration method, candidate identities, local/global metrics, privacy model, resource results, and go/no-go interpretation; verify documentation states that go requires a separate production-integration change and no-go retains P3-A infrastructure.
- [ ] 6.3 Update `D:\learning\Review_md\kun-memory-roadmap.md` and create a stage note under `D:\learning\Review_md\codex` after the decision; verify both record the commit series, checks, immutable evidence hashes, holdout run count, and remaining P4-A work.

## 7. Validation And Delivery

- [ ] 7.1 Run the focused P3-B contract, fixture, evaluator, safety, privacy, determinism, and workflow tests; verify all new cases pass.
- [ ] 7.2 Run the existing Kun Memory focused suites, `npm run build:kun`, `npm run typecheck`, `npm run build`, `npm run lint`, and `npm run check:file-lines`; separate any pre-existing baseline failures from change-introduced failures.
- [ ] 7.3 Run strict OpenSpec validation and `git diff --check`; verify every authored text file remains within 700 physical lines.
- [ ] 7.4 Commit each meaningful artifact group with Angular-style messages and push the preparation branch to SunwardL; verify no formal PR is opened before #1324 and the P3-A closeout are merged.
- [ ] 7.5 After the baseline prerequisites and all decision tasks pass, create one PR targeting `KunAgent/Kun:develop` with Summary, Changes, Tests, decision outcome, evidence hashes, and an explicit statement that production ranking is unchanged.
