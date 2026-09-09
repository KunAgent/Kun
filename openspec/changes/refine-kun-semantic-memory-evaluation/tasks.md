## 1. Freeze the v2 evaluation contract

- [x] 1.1 Add a strict v2 dataset and manifest schema with versioned counts, category quotas, rationales, split metadata, hashes, fixed evaluation time, and frozen gates; verify malformed or unsupported inputs are rejected in focused tests.
- [x] 1.2 Create 40-48 anonymous synthetic Memory records and exactly 40 development plus 40 holdout queries across the declared categories; verify ids, labels, rationales, negatives, language coverage, and category quotas automatically.
- [x] 1.3 Compute and record deterministic record, query, and manifest hashes without changing the v1 fixtures or decision evidence; verify repeated loads produce identical hashes.

## 2. Add paired uncertainty reporting

- [x] 2.1 Add per-query candidate-minus-baseline Recall@K and reciprocal-rank deltas; verify relevant and abstention queries use the specified metric populations.
- [x] 2.2 Add a dependency-free deterministic paired bootstrap with a recorded seed, resample count, and percentile confidence intervals; verify fixed examples, repeatability, and edge cases in focused tests.
- [x] 2.3 Include paired deltas and confidence intervals in evaluation and decision reports without changing existing v1 report parsing; verify report schemas reject missing or inconsistent uncertainty metadata.

## 3. Compare bounded development candidates

- [x] 3.1 Add a deterministic, versioned, hashed English/Chinese terminology map and lexical normalization candidate; verify matching phrases normalize while unrelated queries remain byte-for-byte unchanged.
- [x] 3.2 Add a finite development-only grid for similarity gates and lexical/semantic fusion weights; verify every declared configuration runs against the same authorized corpus, K, prompt budget, and query order.
- [x] 3.3 Add a lock artifact that records dataset hashes, candidate identity, parameters, terminology hash, gates, and bootstrap settings; verify holdout evaluation fails closed before locking or when any locked input drifts.

## 4. Produce decision evidence

- [x] 4.1 Run and record the frozen lexical and terminology-map development baselines; verify reports contain quality, safety, determinism, timing, and resource evidence.
- [x] 4.2 Run the existing E5 candidate and bounded grid on development only, select at most one locked configuration, and verify no holdout result is emitted during tuning.
- [x] 4.3 After the candidate and gates are locked, run the holdout once and generate the v2 go/no-go report with paired intervals and per-category evidence; no candidate passed development eligibility, so the lock and holdout preconditions were not met and the report records a development no-candidate result instead.
- [x] 4.4 Preserve SQLite FTS5 and filesystem fallback as the only production paths; verify the production bundle and runtime dependency graph do not import v2 evaluation modules or a new model dependency.

## 5. Validate and document the stage

- [x] 5.1 Run focused Memory evaluation tests, Kun build, top-level typecheck/build, changed-file lint, file-line checks, OpenSpec strict validation, and `git diff --check`; the v2 evaluation command, `build:kun`, top-level typecheck/build, lint (0 errors; 30 existing warnings), 6,972-file line gate, strict OpenSpec validation, and diff check passed.
- [x] 5.2 Run the full test and lint gates where practical and distinguish any upstream baseline failure from a change-introduced failure in the evidence report; the full test command was attempted but exceeded the approximately 10-minute local observation window without a final summary, so it is recorded as incomplete and deferred to PR Actions rather than reported as passing or failing.
- [ ] 5.3 Update the local Memory roadmap and create a timestamped stage note with commits, dataset identity, metrics, decision, and remaining P2-B boundary; verify local notes are not staged in the repository.
- [ ] 5.4 Push each independently reviewable milestone commit to `SunwardL/Kun:codex/refine-kun-semantic-memory-evaluation`, then create a detailed PR targeting `KunAgent/Kun:develop` only after all required tasks and gates pass.
