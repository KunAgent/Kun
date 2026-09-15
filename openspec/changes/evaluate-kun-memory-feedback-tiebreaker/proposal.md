## Why

P3-A established a private feedback ledger and explicit confirmation/correction flows, but its first additive ranking candidate produced no holdout gain and correctly remained out of production. A separately versioned decision is needed to test the narrower intended use of feedback: resolving genuinely close lexical candidates without weakening global relevance, abstention, authorization, lifecycle, privacy, determinism, or desktop resource bounds.

## What Changes

- Add an anonymous, deterministic evaluation dataset centered on human-labeled near-tie lexical cases, with separate development and holdout splits, fixed hashes, explicit relevance rationales, and scope/lifecycle hard negatives.
- Pre-register a finite near-tie definition grid and bounded feedback candidates before examining holdout results. The grid is derived from foundation-score distributions and labeled error costs; no percentage or weight is treated as proven in advance.
- Compare the unchanged post-#1308 lexical foundation with evaluator-only tie-breakers that can use explicit confirmation and correction evidence only inside the admitted near-tie window.
- Keep retrieval frequency shadow-only so repeated exposure cannot create a self-reinforcing production advantage.
- Report near-tie pair-ordering accuracy separately from global Recall@K, Precision@K, MRR, abstention, false-positive selection, safety, determinism, privacy, and resource metrics. Use deterministic paired bootstrap intervals for global non-regression and any claimed local benefit.
- Preserve dev-to-holdout discipline: select only from the pre-registered grid on development data, lock the candidate and gates, then run holdout once. A no-go is a complete and valid outcome.
- Keep all candidates offline. A go recommendation can authorize a later production-integration proposal but cannot change retrieval behavior, add a dormant ranking flag, or modify canonical Memory in this change.

## Capabilities

### New Capabilities

- `memory-feedback-ranking-evaluation`: Defines the anonymous data contract, near-tie candidate boundary, shadow-only signals, uncertainty and safety gates, holdout discipline, and evaluator-only production isolation for a versioned P3-B feedback-ranking decision.

### Modified Capabilities

None.

## Impact

- Adds versioned anonymous fixtures, manifests, decision plans, evaluator code, traces, evidence, and focused tests under the Kun Memory evaluation surface.
- Reads the existing lexical foundation scores and P3-A feedback aggregates through offline adapters only.
- Does not modify production Memory retrieval, prompt injection, canonical records, Manager/HTTP/UI behavior, settings, packaged dependencies, or the frozen P3-A v1 plan and evidence.
