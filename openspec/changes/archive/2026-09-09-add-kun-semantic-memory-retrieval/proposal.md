## Why

Kun's P0 Memory retrieval is scope-safe, lifecycle-safe, deterministic, and recoverable, but its small lexical fixture does not establish quality for paraphrases, cross-language queries, or relevant memories with little token overlap. A production embedding path would add model, packaging, storage, latency, and privacy costs before there is reproducible evidence that it improves retrieval.

P2-A therefore needs a frozen anonymous benchmark and a fair offline comparison against the current lexical path. Its result is an explicit go/no-go decision; semantic production wiring is allowed only in a separately reviewed P2-B scope after every safety, relevance, and desktop-resource gate passes.

## What Changes

- Add a strictly validated anonymous Memory retrieval dataset with 31 synthetic records and 40 labeled queries split into development and holdout sets.
- Extend the test-only retrieval evaluator with per-query results, split/language/category metrics, abstention accuracy, derived scope/lifecycle negatives, latency percentiles, and resource metadata.
- Record a reproducible P0 lexical baseline using the same records, authorization filters, lifecycle time, result limit, and prompt budget as every candidate.
- Define an offline candidate interface for bounded semantic and hybrid spikes without connecting it to production runtime, HTTP, settings, canonical records, or indexes.
- Pre-register safety, relevance, determinism, latency, model-size, index-size, load-time, build-time, and memory budgets before inspecting holdout results.
- Record candidate identity, version, license, artifact hash, architecture support, parameters, fallback behavior, and a final go/no-go report.
- Keep the canonical Memory V2 schema, existing FTS5/filesystem retrieval, and production packaging unchanged in P2-A.

## Capabilities

### New Capabilities

- `semantic-memory-retrieval-evaluation`: Anonymous frozen retrieval data, fair lexical/semantic/hybrid comparison, safety and resource gates, deterministic evidence, and the P2-A go/no-go decision boundary.

### Modified Capabilities

None.

## Impact

- Adds OpenSpec artifacts, anonymous test data, validation, scorer extensions, candidate adapters, and focused tests under the existing `kun/src/memory` evaluation boundary.
- Reuses the current Memory contracts, scope/lifecycle filtering, ranking, trace, and prompt-budget behavior rather than creating another benchmark system.
- May evaluate at most two local offline candidate runtimes as development-only dependencies or isolated tooling; no candidate becomes a production or packaging dependency in this change.
- Does not read real Memory data by default, make network requests, change the canonical JSON schema, add a vector database, or alter renderer/Main/Manager/runtime behavior.

## Delivery Boundary

This change is P2-A only. Passing the benchmark records evidence for a later P2-B proposal; it does not itself authorize production embedding projection, vector persistence, hybrid turn injection, model download, or new diagnostics. A no-go result is a complete valid outcome and leaves the current FTS5/filesystem retrieval unchanged.
