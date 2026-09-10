## 1. Version and data foundation

- [x] 1.1 Define the v3 dataset/decision schema and version identifiers, then verify strict validation rejects unknown fields, duplicate ids, unresolved labels, missing rationales, and unsupported versions; `semantic-memory-evaluation-v3-dataset.test.ts` covers frozen structure, zero-overlap strata, stale hashes, and Windows line endings.
- [x] 1.2 Record the exact `multilingual-e5-small-q8` model, tokenizer, preprocessing, pooling, normalization, quantization, runtime, and artifact hashes, then verify the candidate manifest is complete and network-independent. The frozen manifest records the E5 revision, ONNX artifact hash, tokenizer hash, prefixes, mean pooling, L2 normalization, q8 artifact, runtime, and dimensions; the loader test verifies the identity from checked-in fixtures.
- [x] 1.3 Build the stratified v3 anonymous corpus and query set with no-evidence, irrelevant, same-category near-miss, scope/lifecycle negatives, and cross-language zero-overlap positive queries; verify expected/forbidden ids and rationales resolve. The checked-in fixture has 44 records, 80 queries, ten balanced categories, eight zero-overlap positives, and strict loader validation for scope, lifecycle, labels, rationales, and zero-overlap content.
- [ ] 1.4 Freeze development/holdout assignment, category quotas, zero-overlap definition, evaluation time, and SHA-256 manifest; verify no duplicate or near-duplicate query crosses the split.

## 2. Offline candidate matrix

- [x] 2.1 Define one evaluator input boundary that applies authorization, lifecycle, K, prompt budget, and deterministic ordering before every candidate; verify all candidates receive identical authorized inputs. `semantic-memory-evaluation-v3-boundary.ts` is now the shared boundary used by the evaluator, with a focused test covering scope, lifecycle, supersession, stable id ordering, K, and prompt budget.
- [ ] 2.2 Recalculate and freeze the post-#1308 pure lexical foundation baseline; verify the report records the new baseline identity without modifying v1/v2 evidence. The evaluator-only baseline factory now pins the identity; the recalculated report is still pending.
- [x] 2.3 Add the current semantic-gated-rrf control wrapper using the fixed E5 artifact; verify it remains evaluator-only and produces bounded traces. The wrapper reproduces semantic-side gating and lexical RRF intersection without changing `semantic-memory-vector-candidate.ts`; tests confirm semantic results remain possible when lexical retrieval is empty.
- [x] 2.4 Add lexical-veto semantic reranking that cannot introduce records rejected by the lexical gate; verify zero lexical admissions return no semantic result. `semantic-memory-v3-candidates.test.ts` covers the admission boundary.
- [x] 2.5 Add lexical-veto plus margin/gap scoring with the pre-registered formula, finite grid, tie behavior, and deterministic selection order; verify every grid configuration is reported. The evaluator wrapper and margin tests now fix top1-top2 gap semantics.
- [x] 2.6 Keep terminology-map normalization as a separately labeled exploratory candidate; verify it cannot be selected as the primary candidate without the same safety and resource gates. The v3 wrapper marks the candidate `exploratory-only` and `primaryCandidateEligible: false` while retaining the shared evaluator safety gates.

## 3. Metrics, uncertainty, and locking

- [x] 3.1 Implement query-level paired deltas against the lexical baseline for Recall@K, Precision@K, MRR, abstention, false positives, and forbidden selections; verify empty-result queries do not inflate ranked-quality denominators. The v3 comparison now reports all six paired dimensions and excludes empty-expected queries from ranked Recall/Precision/MRR samples.
- [x] 3.2 Implement deterministic paired bootstrap intervals with fixed seed, resample count, confidence method, and lower-bound calculation; verify repeated runs produce identical intervals. The v3 comparison reuses the fixed paired-percentile implementation and now has a repeated-run equality test.
- [x] 3.3 Add independent language, category, safety, and zero-overlap-positive Recall@K breakdowns; verify lexical-veto trade-offs are visible separately from aggregate metrics. The v3 report now includes language/category Recall intervals, the dedicated zero-overlap interval, and explicit safety deltas.
- [x] 3.4 Implement finite-grid development selection and a fail-closed holdout lock artifact containing dataset, model, candidate, parameter, baseline, metric, and gate hashes; verify holdout produces no labels or metrics without a valid lock. The workflow enumerates all 54 frozen configurations, applies lower-bound/safety gates, hashes development evidence, and the holdout runner rejects invalid locks before invoking a candidate.

## 4. Automated safeguards

- [ ] 4.1 Add fixture and validator tests for malformed data, missing strata, split leakage, normalization changes, and hash mismatches; verify the complete evaluation rejects invalid input before retrieval.
- [ ] 4.2 Add candidate safety tests for scope, lifecycle, authority, unknown ids, forbidden selections, and network attempts; verify any safety violation forces no-go.
- [ ] 4.3 Add deterministic repeat tests for candidate ids, scores, configuration order, and bounded traces; verify three locked repeats remain within the declared tolerance.
- [ ] 4.4 Add resource and fallback tests for missing/corrupt model artifacts and local runtime failure; verify the evaluator reports unsupported/fallback evidence without relaxing safety.
- [ ] 4.5 Add development-only and holdout-lock tests; verify candidate tuning cannot read holdout labels or emit holdout aggregates before locking.

## 5. Evaluation and delivery evidence

- [ ] 5.1 Run the complete v3 development matrix offline and store per-query selected ids, metrics, bootstrap intervals, resource measurements, and artifact hashes; verify the report is reproducible from the frozen manifest.
- [ ] 5.2 Apply the pre-registered development gates and record either a locked candidate or a development no-go; verify no threshold or grid value changes after result inspection.
- [ ] 5.3 If and only if development passes, run holdout once from the lock artifact; verify a failed holdout remains no-go and does not reopen tuning.
- [ ] 5.4 Write the final v3 decision report and update the roadmap without changing v1/v2 frozen evidence; verify the report states whether P2-B remains blocked.
- [ ] 5.5 Run focused evaluation tests, typecheck, build:kun, build, lint, file-lines, OpenSpec strict validation, and diff check; verify no production retrieval file or model asset is changed.
