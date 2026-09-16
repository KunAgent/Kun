# P3-B delivery checklist

## Dependency checkpoint: 2026-09-17

- P3-A PR #1324: CI passed, still open and review required at head `dee7b413`.
- Importer PR #1326: merged as `d784a47d`; unrelated to this capability.
- Fetched upstream develop: `1d456093`.
- Preparation branch: `codex/prepare-memory-feedback-tiebreaker` on SunwardL/Kun.
- Shared P3-A ancestor: `f9b49d0e`; nine newer P3-A commits are not yet included.

These are a dated checkpoint, not a claim that the branch is ready to merge.

## Work that can proceed before the dependency merges

- [x] Reproduce development and candidate lock tests without scoring holdout.
- [x] Record development rejection and distinguish explicit forbidden selections
  from authorization/lifecycle violations in `development-review.md`.
- [x] Keep data, evaluator, tests and documentation as meaningful separate commits.
- [ ] Obtain independent review of labels, lock and the control-only holdout
  question described in `development-review.md`.
- [ ] Review correction evidence against the latest P3-A event/aggregate contract;
  do not assume an old evaluator's aggregate attribution matches persisted data.

## After P3-A merges

1. Verify #1324 is MERGED and record its actual merge SHA, not just green checks.
2. Create a separate closeout branch from current upstream develop. Synchronize
   the P3-A delta into the main spec, archive its completed change, validate and
   submit the independent closeout PR. Preserve frozen P3-A evidence.
3. Once closeout merges, fetch upstream develop and origin, confirm the worktree
   is clean, then rebase this preparation branch using the verified P3-A boundary.
   Preserve meaningful P3-B commits; do not replay obsolete P3-A implementation
   commits as new P3-B changes. Use force-with-lease only if a rebase requires it.
4. Review the final three-dot diff against upstream develop. It should contain
   only this evaluation capability, anonymous artifacts and tests; no importer,
   production ranking, runtime composition or UI changes.
5. Verify P3-A review fixes survived: runtime feedback getter wiring, isolated
   diagnostics, disabled correction semantics, confirmation gating, malformed
   ledger recovery documentation, IPC allowlist and runtime-config line budget.
6. Reproduce frozen development evidence and hashes on the merged baseline.
   If semantics changed, report the mismatch; do not overwrite frozen inputs or
   silently regenerate a more favorable decision under the same version.
7. Complete the independently reviewed decision workflow. Do not treat a
   foundation fallback lock as go or report an unexecuted holdout as passed.
8. Run focused P3-B and existing Memory tests, build:kun, typecheck, build, lint,
   file-lines, strict OpenSpec validation and diff check. Record failures honestly.
9. Finish tasks 6.2/6.3 and the stage report, including immutable evidence hashes,
   holdout run count and remaining P4-A work. Update the local roadmap.
10. Push the verified branch and create one PR to `KunAgent/Kun:develop`.
    Immediately verify the base, head and URL. CI success on #1324 does not
    certify this new PR; it needs its own checks.

## PR body outline (complete evidence before submitting)

### Summary

Evaluate bounded explicit-feedback tie-breakers offline. Production Memory
ranking remains unchanged. P3-A ledger/confirm/correct infrastructure is retained.

### Changes

Anonymous stratified data, baseline-derived near-tie grid, deterministic
comparison, versioned gates and lock, privacy/resource checks, development
report and independently reviewed decision outcome.

### Tests

Preparation checkpoint: 17 P3-B test files / 62 tests passed on 2026-09-17;
strict OpenSpec validation and changed-test ESLint passed. Replace this checkpoint
with final post-rebase verification results before submitting.

### Decision and limitations

Development currently has no eligible feedback candidate. Include final reviewed
outcome, artifact hashes, actual holdout run count and sample-size limitations.
Do not claim production relevance gains or enable ranking from this PR.
