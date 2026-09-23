# P3-B delivery checklist

## Dependency checkpoint: 2026-09-17

- P3-A PR #1324: CI passed, still open and review required at head `dee7b413`.
- Importer PR #1326: merged as `d784a47d`; unrelated to this capability.
- Fetched upstream develop: `1d456093`.
- Preparation branch: `codex/prepare-memory-feedback-tiebreaker` on SunwardL/Kun.
- Shared P3-A ancestor: `f9b49d0e`; nine newer P3-A commits are not yet included.

These are a dated checkpoint, not a claim that the branch is ready to merge.

## Current synchronization checkpoint: 2026-09-20

- `upstream/develop` is synchronized at `4778f9eb`.
- P3-A implementation #1324 is merged at `8974700b`.
- P3-A closeout #1331 is closed without merge; its substantive documentation
  changes are included in this branch as `c56c8e7c` and `374eedf7`.
- The final delivery will use one P3-B PR; no standalone P3-A closeout PR will
  be reopened.
- Post-sync verification: the focused P3-B suite passed (18 files / 70 tests),
  `npm run build:kun` passed, and strict OpenSpec/diff/file-line checks passed.
  Full `npm run typecheck` remains blocked by the pre-existing missing
  `phonemizer` declaration in `src/main/services/local-kokoro-worker-entry.ts`;
  this is not introduced by P3-B.

## Work that can proceed before the dependency merges

- [x] Reproduce development and candidate lock tests without scoring holdout.
- [x] Record development rejection and distinguish explicit forbidden selections
  from authorization/lifecycle violations in `development-review.md`.
- [x] Keep data, evaluator, tests and documentation as meaningful separate commits.
- [ ] Obtain independent review of labels, lock and the control-only holdout
  question described in `development-review.md`.
- [x] Review correction evidence against the P3-A event/aggregate contract and
  test real correction, replay, compaction and restart. Replacement evidence is
  deliberately distinct from the old record's aggregate correction count.
  Repeat integration checks after the final P3-A baseline synchronization.

## After the P3-A implementation merge

1. Verify #1324 is MERGED and record its actual merge SHA, not just green checks.
2. Keep the P3-A canonical-spec synchronization and completed-change archive in
   the same final P3-B PR. Preserve frozen P3-A evidence; do not reopen a
   standalone closeout PR.
3. Fetch upstream develop and origin, confirm the worktree is clean, then
   rebase this preparation branch onto the latest baseline. Preserve meaningful
   P3-B commits; do not replay obsolete P3-A implementation commits as new
   P3-B changes. Use force-with-lease only if a rebase requires it.
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
10. Push the verified branch and create one PR containing the P3-B evaluation
    and the P3-A spec/archive closeout to `KunAgent/Kun:develop`.
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

## Final closeout checkpoint: 2026-09-23

This checkpoint supersedes the earlier preparation steps above. The P3-B
development grid and candidate lock are frozen and reproducible on the latest
`upstream/develop@65f6a55c4`. No feedback candidate passes all development gates;
the v1 decision is closed at development no-go. The historical holdout output is
not decision-grade because its runner allowed repeated temporary-directory runs
and did not measure every gate. The runner is retired, the output and all frozen
inputs are unchanged, and no holdout metrics are used in the decision.

The final PR includes the offline P3-B evaluation and P3-A canonical-spec/archive
closeout together. It does not include a UI toggle, feedback-based production
ranking, or a production integration decision. `feedback.enabled` remains off by
default, and any future production-ranking proposal requires a separately
versioned decision that passes its gates.

Post-rebase checks recorded for this closeout: P3-B focused suite passed
(19 files / 71 tests); all Kun Memory tests passed (57 files / 296 tests);
`npm run build:kun`, Memory-directory ESLint, strict OpenSpec validation, and
`git diff --check` passed. Root `npm run typecheck` reports two `AgentModelSettings`
type errors in an unchanged upstream file and cannot resolve Excalidraw because
that declared dependency is missing from this local `node_modules`. Root
`npm run build` stops on the same missing local package. Root `npm run lint`
stops before ESLint because unchanged upstream files exceed the file-line gate:
`register-app-file-ipc-handlers.ts` (707 lines) and `remote-bridge.js` (750).
The evaluator/Memory ESLint run passes. These failures are reported separately;
they are not described as passing gates. The PR must state plainly that holdout
is not decision-grade and that this is a development-only no-go.

PR #1339 is open at <https://github.com/KunAgent/Kun/pull/1339>, with base
`develop` and head `SunwardL:codex/prepare-memory-feedback-tiebreaker`. The initial
GitHub Quality gates check is pending; creation does not imply review or merge.
