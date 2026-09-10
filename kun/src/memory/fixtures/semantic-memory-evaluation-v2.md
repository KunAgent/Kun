# Semantic Memory Evaluation v2

Status: development screening complete; no candidate eligible for holdout.

## Purpose

Version 2 replaces the small v1 decision sample with a separately frozen 40-query development split and 40-query holdout split. It preserves the v1 no-go evidence, adds paired uncertainty reporting, and compares a low-cost terminology-map candidate before any production model integration is considered.

This remains an evaluation-only artifact. SQLite FTS5 and filesystem fallback are the only production retrieval paths.

## Frozen dataset

- 44 anonymous synthetic Memory records.
- 40 development and 40 holdout queries.
- 20 English and 20 Chinese queries in each split.
- Seven primary categories covering lexical controls, paraphrases, cross-lingual retrieval, terse prompts, scope/lifecycle behavior, abstention/authority, and multi-relevant retrieval.
- Every query records expected ids, forbidden ids, and a human-readable relevance rationale.
- Records SHA-256: `d3420b44d74a7b65a69e74ed4a0120fe36439c84defb829b118ae59e33ef94b2`.
- Queries SHA-256: `a7f1f5f8081034606f1dd1a222bbd09006242e60290a08f8348cd9ecdaa8cbc4`.
- Manifest SHA-256: `6bb40694307e2f7a80666781919ae8778c9de960596bc17a45b4ee08de912320`.

The manifest and checksum file are the source of truth for counts, quotas, fixed evaluation time, bootstrap settings, and decision gates.

## Development candidates

All candidates ran against development queries only and used the same authorized corpus, query order, K, and prompt budget.

| Candidate | Recall@5 | Precision@5 | MRR | Abstention accuracy |
| --- | ---: | ---: | ---: | ---: |
| Lexical baseline | 0.482 | 0.202 | 0.500 | 1.000 |
| Terminology map | 0.676 | 0.199 | 0.644 | 1.000 |
| Best E5 grid result | 0.769 | 0.199 | 0.564 | 0.000 |

The E5 grid covered 18 pre-registered combinations of similarity threshold, semantic weight, and rank constant. Its best development Recall@5 delta was `+0.287028`; the deterministic paired 95% bootstrap lower bound was `+0.148139`.

## Decision

No configuration passed development eligibility. Every E5 configuration failed the frozen abstention requirement by returning results for queries that required an empty result. This is a safety/precision boundary, not evidence that embedding retrieval is categorically ineffective.

Because no candidate was eligible:

- no lock artifact was created;
- holdout evaluation was not run;
- no holdout query ids or metrics appear in the development evidence;
- P2-B production integration remains blocked.

Changing the grid, abstention behavior, dataset, or gates requires a new decision version. The frozen evidence must not be tuned after the fact.

## Evidence and commands

- Dataset: `semantic-memory-records.v2.json`, `semantic-memory-queries.v2.json`, and `semantic-memory-manifest.v2.json`.
- Development evidence: `semantic-memory-v2-development-screening.v2.json`.
- Terminology map: `semantic-memory-terminology-map.v1.json`.
- Focused gate: `npm --prefix kun run eval:memory-retrieval`.

The E5 model and its Transformers/ONNX runtime were used only from an external isolated evaluation directory. They are not repository assets or runtime dependencies.
