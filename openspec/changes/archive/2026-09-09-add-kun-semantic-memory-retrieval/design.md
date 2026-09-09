## Context

See `proposal.md` for motivation and `specs/semantic-memory-retrieval-evaluation/spec.md` for the behavior contract. P0 already provides canonical Memory V2 parsing, scope/lifecycle filters, deterministic lexical retrieval, bounded prompt assembly, an anonymous six-query fixture, and a small aggregate scorer. P2-A extends that test boundary; production Memory continues to use canonical JSON plus rebuildable SQLite FTS5 and filesystem fallback.

The prepared dataset contains 31 synthetic records and 40 queries, of which 32 are development and 8 are holdout. It covers English, Chinese, semantic paraphrases, cross-language retrieval, scope/lifecycle negatives, temporal validity, authority safety, abstention, and multi-record recall. All paths and contents are synthetic.

## Goals / Non-Goals

**Goals:**

- Freeze and strictly validate one versioned anonymous dataset before experiments.
- Produce a new lexical baseline through the same authorization, K, and prompt-budget boundary used by later candidates.
- Make quality, safety, timing, and resource comparisons deterministic and machine-readable.
- Permit small local semantic/hybrid spikes without exposing them to production callers.
- End P2-A with an auditable go/no-go report whose no-go outcome is valid.

**Non-Goals:**

- Changing `MemoryRecord`, canonical JSON, the Manager repository, HTTP routes, settings, renderer, or turn injection.
- Adding a production vector index, embedding service, model downloader, or packaged model.
- Sending Memory contents to hosted embedding APIs or using an LLM reranker.
- Selecting P2-B storage, model distribution, UI, or diagnostics before P2-A passes.

## Decisions

### 1. Extend the existing evaluation boundary

Keep the P0 fixture and scorer as a compatibility regression and add cohesive P2-A dataset, loader, scoring, and report modules beside them under `kun/src/memory`. Shared metric helpers may be reused by the old test, but P2-A will not replace its historical six-case result.

Alternative considered: create an external benchmark package. Rejected because it would duplicate Memory contracts and authorization semantics and could drift away from the production lexical path.

### 2. Store source data as strict versioned JSON

Check in separate records and queries JSON files. A test-only loader validates the root object and every nested field with strict schemas, rejects unknown versions and fields, then materializes records through the production `MemoryRecord` schema using deterministic audit fields and bounded fixture provenance.

The released v1 contract requires 31 records, 40 queries, exactly 32 development and 8 holdout queries, unique ids, resolvable expected/forbidden ids, and no expected/forbidden overlap. Its record and query SHA-256 values are recorded in the dataset manifest and decision report. Any content or label edit creates a new dataset version and baseline.

Alternative considered: express fixtures as TypeScript constants. Rejected because JSON is easier to hash, review, validate independently, and consume from isolated candidate tooling.

### 3. Filter once before every candidate

The runner materializes a query context, uses `memoryInScope` and `memoryLifecycleState` at the frozen evaluation time, and passes only authorized active records to a candidate adapter. Explicit hard negatives remain useful for lexical distractors, while the runner independently derives every out-of-scope and inactive record as forbidden.

Candidate adapters return ordered selections, bounded scores/channel metadata, and timing. They cannot request the unfiltered corpus. This prevents a vector implementation from embedding private cross-scope records and filtering only after similarity search.

Alternative considered: let each candidate filter internally. Rejected because it makes safety incomparable and permits accidental information exposure before ranking.

### 4. Separate ranked metrics from abstention

Recall@K, Precision@K, and reciprocal rank use only non-empty expected sets. Empty expected sets produce abstention correctness and false-positive counts. Reports include per-query results and aggregate breakdowns by split, language, and category.

Explicit hard-negative selections remain a quality diagnostic because some are authorized same-scope distractors. Safety counters separately cover derived scope leaks, lifecycle leaks, unknown selections, authority mismatches, network attempts, and fallback mismatches. Any nonzero safety counter forces no-go and cannot be averaged away.

Alternative considered: preserve P0's convention that empty expected sets contribute perfect Recall/MRR. Rejected because adding easy no-result queries would inflate ranking quality.

### 5. Freeze before baseline and protect holdout

Dataset review, thresholds, reference hardware, K=5, prompt-character budget, evaluation time, hashes, and scoring version are committed before candidate results. The lexical baseline is then recorded on the full frozen set. Candidate and fusion choices use only development queries. After model identity and parameters are locked, the holdout is run once for the decision and the full run is repeated three times from clean process state.

The evaluator supports selecting a split, but ordinary development output must not print holdout labels or results before the candidate is locked. A post-holdout dataset or threshold change requires an explicit version bump and a fresh baseline.

### 6. Use a deterministic candidate adapter and simple fusion

P2-A defines an evaluation-only adapter instead of a production embedding port. A candidate must expose stable metadata and accept only filtered records. If a hybrid candidate is tried, it uses deterministic rank fusion such as reciprocal-rank fusion with fixed parameters; no LLM reranking is allowed.

At most two candidates should enter development experiments after license, size, and platform screening. Candidate runtime or model dependencies remain isolated from normal production imports and packaging.

Alternative considered: introduce the future production vector port now. Rejected because its lifecycle, projection storage, and model distribution depend on the P2-A decision.

### 7. Measure latency and resources explicitly

Each query records elapsed time. Aggregate reports calculate p50 and p95 from deterministic sorted samples. Candidate evidence also records cold readiness, five warmups plus at least 30 measured warm iterations, full fixture build, deterministic 10,000-record build, incremental projection, model/index byte counts, and process RSS delta.

Absolute resource gates use a recorded Windows x64 reference-machine profile. Cross-platform support is captured from primary project/runtime evidence; lack of a required architecture is visible and can yield no-go rather than being hidden behind an average.

### 8. Prove offline behavior and fallback without production wiring

Candidate execution receives no network capability. Tests instrument common Node network entry points to fail and count attempts; candidate subprocesses, if used, run with an explicit offline contract and no credentials. Missing, corrupt, or unsupported candidate artifacts must produce an explicit evaluation status and a lexical result identical to the reference candidate.

This tests the fallback contract at the candidate boundary without adding a dormant production fallback branch.

### 9. Keep the decision machine-readable

The final report records dataset/scoring versions and hashes, baseline, candidate metadata, locked parameters, three-run evidence, every threshold with pass/fail, and the final decision. A deterministic decision function derives `go` only when every mandatory gate passes; maintainers do not manually override a failed safety gate inside the report.

A go result opens a new P2-B proposal from the then-current `develop`. It does not extend this change into production code.

## Risks / Trade-offs

- [Forty queries are not statistically comprehensive] → Treat v1 as a regression and decision set, report every subgroup, preserve holdout, and avoid claims beyond its coverage.
- [Synthetic language may not match real usage] → Permit separately invoked, non-committed local diagnostics only after anonymization; never mix them into the frozen default score.
- [Accidental lexical overlap can understate semantic gains] → Review overlap before freeze and retain both lexical controls and exact zero-overlap cases.
- [Performance varies across machines] → Record the exact reference profile and separate absolute reference budgets from relative candidate comparisons.
- [Dependency experiments can leak into production packaging] → Keep candidate imports behind evaluation-only entry points and verify normal build/dependency/package surfaces remain unchanged.
- [Holdout can be inspected accidentally] → Make split selection explicit and record candidate-lock metadata before accepting holdout output.
- [Network instrumentation can miss subprocess traffic] → Prefer in-process candidates; where a subprocess is unavoidable, combine denied credentials/proxy settings with an explicit invocation audit and document residual limits.

## Migration Plan

1. Add and freeze the v1 anonymous dataset, schema, hashes, thresholds, and reference-machine profile.
2. Land the strict loader, common evaluator, safety derivation, and lexical adapter while keeping existing P0 tests green.
3. Save the lexical baseline and validate deterministic reruns.
4. Add isolated candidate metadata and development-only spike tooling for screened local candidates.
5. Lock one candidate and fusion configuration, run holdout and clean repetitions, then commit the decision report.
6. If no-go, remove unneeded candidate artifacts/dependencies and retain only reproducible evidence. If go, keep P2-A production-neutral and create a new P2-B change.

Rollback is deletion of the P2-A evaluation files and OpenSpec change; no user data or runtime migration is required because production behavior and canonical storage never change.
