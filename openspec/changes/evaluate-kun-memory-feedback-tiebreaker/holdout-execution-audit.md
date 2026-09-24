# Holdout execution correction

This audit supersedes earlier claims of a compliant single holdout run and fully
measured holdout gates. Production ranking and the frozen development artifacts
are unchanged. The development no-go remains the supported decision.

## Execution deviation

The independent Opus 4.8 review authorized one foundation-control holdout.
The runner test was incorrectly described as synthetic: it loaded the real frozen
holdout, scored it in temporary directories, and deleted temporary outputs during
cleanup. The recorded session shows at least five successful test invocations plus
the repository write. The artifact's `holdoutRunCount: 1` does not account for those
attempts or internal determinism replays; it is not proof of one-shot compliance.

The same-directory exclusive writer worked, but changing directories bypassed
experiment-level discipline. The real-data runner is now retired and its
environment-triggered execution test removed. The regression test checks rejection
without loading/scoring data. Generic writer tests retain synthetic payloads.

## Measurement limitations

- Development privacy/determinism/resource flags were assigned true, not measured
  by this runner.
- Holdout timing excluded bootstrap and deterministic replay; the determinism
  check compared selected IDs, not full numeric scores and metrics.
- Privacy validation checked the final payload, not all intermediate traces.
- Bootstrap lower bounds were originally literal zero for the identity control.
  Later computation cannot retroactively certify the first execution.
- The loader checked fixture/manifest checksums, but the runner did not explicitly
  bind those hashes to the plan. Non-null boundaries also silently used zero.

## Final disposition (2026-09-23)

Preserve `kun/src/memory/fixtures/kun-memory-feedback-tiebreaker-v1.json` unchanged
as historical output, NOT independent decision-grade holdout evidence. Do not edit
its flags, delete it, or rerun v1 to make the history appear compliant. The
pre-execution review remains valid within its scope; it does not certify the later
implementation. The contributor closes v1 at the development no-go and accepts
the execution deviation explicitly: no valid holdout result exists, and no holdout
metrics are used in the decision. Task 4.6 records this closure rather than a
completed holdout run. Any renewed holdout work requires a new decision version,
fresh execution controls, and independent review. Production ranking is unchanged.
