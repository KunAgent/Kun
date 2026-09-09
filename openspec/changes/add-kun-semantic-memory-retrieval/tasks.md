## 1. Freeze the anonymous evaluation contract

- [x] 1.1 Review the 31 synthetic records and 40 query labels for ambiguity, privacy, split balance, and accidental lexical overlap; record the accepted coverage and verify no real account, repository, credential, conversation, or machine path is present.
- [x] 1.2 Add the versioned record/query JSON files and strict dataset schemas; verify valid v1 data loads and unsupported versions, unknown fields, duplicate ids, invalid Memory fields, unresolved references, split-count drift, and expected/forbidden conflicts are rejected.
- [x] 1.3 Record the frozen evaluation time, K, prompt budget, thresholds, reference Windows x64 profile, and record/query SHA-256 values in a checked-in manifest; verify changing either data file fails the manifest-integrity test.

## 2. Build the fair comparison evaluator

- [x] 2.1 Add an evaluation-only candidate contract and a common scope/lifecycle prefilter; verify candidates never receive cross-workspace, cross-project, disabled, deleted, expired, future-valid, or superseded records.
- [x] 2.2 Extend scoring with per-query output plus overall, split, language, and category Recall@K, Precision@K, MRR, abstention, and false-positive breakdowns; verify empty expected sets do not contribute perfect ranked metrics.
- [x] 2.3 Derive forbidden ids from scope/lifecycle state in addition to explicit hard negatives and detect authority or fallback mismatches; verify every nonzero safety counter forces a no-go decision.
- [x] 2.4 Add deterministic percentile and resource-report helpers for cold readiness, warm p50/p95, build/projection time, model/index bytes, and RSS; verify sample ordering and percentile edge cases with focused tests.
- [x] 2.5 Add an offline execution guard that counts and rejects network attempts from in-process candidates; verify the fixture evaluation completes with zero network attempts.

## 3. Record the lexical reference baseline

- [x] 3.1 Implement a lexical candidate adapter over the existing Memory retrieval path with the frozen K, prompt budget, filters, and evaluation time; verify selected ids match direct production lexical retrieval for every query.
- [x] 3.2 Generate and check in the machine-readable v1 lexical baseline with per-query and aggregate metrics, timing context, dataset hashes, ranking weights, and candidate identity; verify regeneration produces no content diff except explicitly excluded timing samples.
- [x] 3.3 Repeat the clean lexical evaluation three times and verify selected ids, safety counters, and deterministic scores are identical.

## 4. Screen and run local semantic candidates

- [x] 4.1 Research at most two local candidates using primary license/runtime sources and record model version, license, artifact hash, dimensions, normalization, payload size, supported platforms/architectures, and redistribution constraints; verify candidates requiring hosted Memory uploads are excluded.
- [x] 4.2 Implement isolated development-split adapters for the screened candidates and optional deterministic rank fusion without importing them from production runtime code; verify normal Kun build and packaging dependency surfaces remain unchanged.
- [x] 4.3 Run development-only quality, safety, latency, build, storage, and RSS measurements; verify holdout results are absent until one candidate and its parameters are locked.
- [x] 4.4 Exercise missing, corrupt, unsupported, and initialization-failure paths; verify fallback selections equal the lexical adapter and all network/scope/lifecycle/authority counters remain zero.

## 5. Make the P2-A decision

- [x] 5.1 Lock the chosen candidate, artifact identity, numeric tolerance, and fusion parameters in the manifest before holdout; verify later parameter drift invalidates the decision run.
- [ ] 5.2 Run the holdout once and repeat the full frozen evaluation three times from clean process state; verify deterministic ids/scores and retain each machine-readable result.
- [ ] 5.3 Generate the final threshold-by-threshold go/no-go report; verify any failed safety, relevance, determinism, or desktop-resource gate produces `no-go`, while `go` only recommends a separate P2-B OpenSpec change.

## 6. Documentation and delivery gates

- [ ] 6.1 Update Memory evaluation documentation and the external roadmap with dataset identity, commands, limitations, and the decision; verify docs never imply P2-A changed production retrieval.
- [ ] 6.2 Run focused Memory tests, `npm run build:kun`, `npm run typecheck`, `npm run build`, strict OpenSpec validation, `npm run check:file-lines`, ESLint for changed source files, and `git diff --check`; record any unrelated full-suite baseline failure separately.
- [ ] 6.3 Prepare the P2-A PR with artifacts, anonymous data, evaluator, frozen baseline, candidate evidence, and decision report only; verify the PR targets `KunAgent/Kun:develop` and contains no production semantic wiring or real Memory data.
