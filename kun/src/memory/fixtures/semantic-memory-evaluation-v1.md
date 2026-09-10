# Semantic Memory retrieval evaluation v1

This directory contains the frozen anonymous P2-A decision dataset. It is test-only evidence and does not alter production Memory retrieval.

## Identity

- Dataset: `kun-memory-semantic-retrieval-anonymous-v1`
- Evaluation time: `2026-09-09T00:00:00.000Z`
- Result limit: 5
- Prompt character budget: 2,000
- Records: 31
- Queries: 40
- Development: 32
- Holdout: 8
- English: 27
- Chinese: 13
- Empty expected set: 4

The manifest records the raw-file SHA-256 values, pre-registered decision thresholds, and anonymous reference-machine profile. Editing a frozen data file without changing the version and manifest makes validation fail.

## Accepted coverage

| Category | Queries |
|---|---:|
| Lexical control | 6 |
| Semantic paraphrase | 10 |
| Cross-lingual | 12 |
| Project-scope negative | 2 |
| Workspace-scope negative | 2 |
| Lifecycle negative | 4 |
| Temporal current/future | 1 |
| Authority safety | 1 |
| No result | 1 |
| Multi-record recall | 1 |

The semantic-paraphrase and cross-lingual groups contain eight exact zero-token-overlap cases under the production tokenizer, including three holdout cases. Other cases retain low overlap or deliberate lexical distractors so the benchmark does not measure only one failure mode.

## Review and privacy

Every record and query is synthetic. `Ember`, `Lumen`, `Borealis`, `Aurora`, and the `/fixtures/p2a/...` roots are invented benchmark identifiers. References to public technologies such as PostgreSQL and GitHub Actions describe only these invented projects.

The freeze review found no Windows drive path, UNC path, email address, GitHub user path, credential assignment, real repository path, account name, conversation excerpt, or canonical Kun Memory content. The default loader has no option that discovers a user data directory.

`forbiddenIds` contains both same-scope relevance distractors and explicit hard negatives. It is reported as a quality metric. Scope and lifecycle violations are derived independently from the complete corpus and remain decision-blocking even when a fixture author forgets to list an id.

## Holdout rule

Development queries may be used for candidate and fusion selection. Holdout labels and metrics cannot be used until candidate identity, artifact hash, normalization, parameters, fusion rule, and numeric tolerance are locked. A label, threshold, or split change after that point requires a new dataset version and lexical baseline.

## Current baseline

The `semantic-memory-lexical-baseline-*.v1.json` files are one logical baseline split into a summary, development relevance cases, development boundary cases, and holdout cases to satisfy the repository file-line gate. They are generated from the existing filesystem lexical retrieval path. Wall-clock samples are excluded from the deterministic snapshot; measured latency and resource evidence belong in candidate run reports.

The v1 lexical result establishes comparison values rather than a passing P2-A result. In particular, its empty-result accuracy is zero, while scope, lifecycle, authority, unknown-selection, network, and fallback counters are zero. A later candidate must pass every frozen gate before P2-B can be proposed.

## P2-A decision

P2-A evaluated two local q8 candidates through an isolated `@huggingface/transformers` 4.2.0 runtime. No runtime package, model asset, or generated vector index is part of Kun's dependency or packaging surface. The submitted TypeScript adapter is evaluation-only and is not exported by the production Memory module.

The development split selected `multilingual-e5-small-q8-hybrid-0.8-1`: cosine similarity 0.80 first gates the authorized records, then equal-weight RRF with rank constant 60 lets the existing lexical order rerank only those surviving records. Candidate metadata, model revision and SHA-256, prefixes, normalization, fusion parameters, supported platforms, and numeric tolerance were locked in the manifest before holdout execution.

The locked holdout improved Recall@5 from 0.500 to 0.625, but the 0.125 gain missed the frozen 0.15 requirement. Holdout MRR remained 0.500, missing the required 0.10 gain. Every safety, offline, determinism, precision, lexical-control, latency, build, size, and memory gate passed. Three clean full runs produced the same deterministic report hash. The derived decision is therefore **no-go**: production continues to use SQLite FTS5 and filesystem fallback, and this candidate does not authorize a P2-B change.

Machine-readable evidence:

- `semantic-memory-development-screening.v1.json`: development-only comparison; no holdout output.
- `semantic-memory-e5-resources.windows-x64.v1.json`: 30 warm samples, 10,000-record build, storage, and RSS evidence.
- `semantic-memory-e5-decision.v1.json`: holdout selections, full metrics, clean-run hashes, failed gates, and production recommendation.

Run the checked-in evaluation and decision tests with:

```sh
npm --prefix kun run eval:memory-retrieval
```

The command uses only anonymous checked-in data and does not download a model. Reproducing the model experiment additionally requires obtaining the exact locked artifact in an isolated local runtime; hosted Memory upload and LLM reranking were not evaluated. The 40-query synthetic set is a regression and decision set, not evidence of broad real-world quality.

## Local validation

The 2026-09-09 Windows x64 validation passed the P2-A focused suite (7 files, 38 tests), `build:kun`, root typecheck, root build, the 700-line gate, full lint (0 errors, 30 existing warnings), strict OpenSpec validation, and `git diff --check`.

The full `npm test` run completed 5,751 tests successfully, skipped 27, and reported 22 failures in seven files outside this change. Re-running those files with the user's normal PATH restored `sqlite3.exe` and made both Chromium cookie files pass (22 tests). Eleven unrelated failures remained reproducible in five unchanged upstream files: eight file-session index assertions, two Windows/POSIX path expectations, and one POSIX permission-bit expectation. No failed file or its production module is changed by P2-A.
