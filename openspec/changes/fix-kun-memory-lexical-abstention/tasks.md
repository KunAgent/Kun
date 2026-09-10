## 1. Freeze the production contract and audit fixture

- [x] 1.1 Add the delta spec for the versioned foundation lexical relevance gate and validate the change strictly.
- [ ] 1.2 Add an anonymous regression fixture for q033/q034 false positives and q035/q036 correct abstention without modifying frozen v1/v2 evidence.
- [ ] 1.3 Record the current shared predicate, filesystem scores, and expected SQLite/fallback parity in focused test notes.

## 2. Verify both production retrieval modes

- [ ] 2.1 Add shared ranking tests proving below-threshold lexical-only candidates are irrelevant while type-affinity candidates remain eligible.
- [ ] 2.2 Add an in-memory SQLite FTS5 integration test using the real `HybridMemoryIndex`/store path and compare q033–q036 selected ids and bounded features with filesystem fallback.
- [ ] 2.3 Verify scope, lifecycle, authority, prompt budget, and degraded fallback behavior remain unchanged.

## 3. Implement and calibrate the gate

- [ ] 3.1 Add the named foundation threshold and shared relevance predicate with no user-facing configuration.
- [ ] 3.2 Run the complete v2 development split at the selected threshold and record Recall@K, Precision@K, MRR, abstention, forbidden selections, safety, timing, and deterministic trace evidence.
- [ ] 3.3 Confirm q033/q034 abstain in both modes, q035/q036 remain empty, and no existing focused Memory test regresses.

## 4. Validate and deliver

- [ ] 4.1 Run focused Memory tests, `build:kun`, typecheck, build, changed-file lint, file-lines, OpenSpec strict validation, and `git diff --check`.
- [ ] 4.2 Run the full test/lint gates where practical and distinguish infrastructure or upstream baseline failures from this change.
- [ ] 4.3 Update the Memory roadmap and create a timestamped stage note with metrics, selected threshold, trade-offs, and the terminology/semantic boundary.
- [ ] 4.4 Push independently reviewable commits to `SunwardL/Kun:codex/fix-memory-lexical-abstention`, then create a detailed PR targeting `KunAgent/Kun:develop`.
