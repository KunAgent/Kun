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
