# P3-B development review

## Outcome and scope

The frozen `p3-feedback-tiebreaker-v1` development grid has no eligible feedback
candidate. This is a development rejection, not a completed holdout decision.
The lock selects `foundation-control` because the pre-registered selection rule
uses it as the fallback. A valid lock is not a passed decision gate.

Production ranking, canonical Memory, and frozen P3-A evidence are unchanged.
Even a future go would require a separate production-integration change.

## Method and evidence

Artifacts are under `kun/src/memory/fixtures/`, with the common prefix
`memory-feedback-tiebreaker-` and suffix `.v1.json`:

- `calibration`: development-only adjacent foundation gaps, floor-index
  quantiles 0.25/0.5/0.75, deduplicated inclusive boundaries 0/0.0075/0.01125.
- `plan`: seven configurations; foundation control plus confirmation-only and
  confirmation-plus-correction at each boundary. Leader-relative groups have
  a maximum reorder window of three. Frequency is shadow-only.
- `development`: 18 synthetic cases, including four labeled preference pairs,
  16 ranked cases and two no-result cases. These are not real-traffic estimates.
- `lock`: fixed candidate, gates, dependency hashes, evaluator identity and seed.

Bootstrap uses 10,000 paired case resamples, seed 20260916, confidence 0.95.
Calibration boundaries and all gates remain frozen; no labels or parameters
were changed after inspecting this outcome.

| Development metric | Foundation | Confirmation + correction, gap_1 or gap_2 |
| --- | --- | --- |
| Pair accuracy | 0 | 0.75 |
| Recall / Precision / MRR | 0.4375 | 0.625 |
| Pair gain lower bound | 0 | 0.25 |
| Recall / MRR gain lower bound | 0 | 0.0625 |
| Abstention accuracy | 1 | 1 |
| Explicit forbidden selections | 6 | 3 |
| Authorization / lifecycle violations | 0 | 0 |
| All required gates passed | false | false |

Both improved configurations pass local-benefit and global non-regression
checks, but fail the zero-explicit-forbidden-selection gate. Reduced errors
are not zero errors. These same-scope relevance failures must not be described
as authorization leaks. The foundation also fails this absolute gate; it is
retained as an unchanged control, not certified as error-free.

## Privacy, resources and reproducibility

Traces are restricted to synthetic ids and numeric features; query text,
Memory content, source excerpts, credentials and machine paths are excluded.
Resource ceilings are 5,000 ms, 64 rankings per trace and 1,000,000 serialized
evidence bytes. These are evaluator limits, not measured production overhead
or a memory-RSS budget. Resource tests measure development execution and reject
over-limit output without truncation; no holdout resource result is claimed.

From `kun/`, run the installed Vitest executable with:

```text
vitest run src/memory/memory-feedback-tiebreaker
```

This verifies fixture integrity, development reproduction, lock validation,
safety, privacy, resource bounds and holdout guards. Guard tests do not publish
a scored holdout decision. Full repository gates must run again after rebasing.

## Review checkpoint before holdout

Task 4.6 remains open. Independent review of labels, candidate lock and frozen
inputs has not been recorded. Do not infer that review from #1324 approval,
which reviews P3-A rather than this P3-B experiment.

The existing plan explicitly falls back to foundation control and the current
task wording still requests one reviewed holdout run. Before consuming holdout,
reviewers should settle whether to retain that control-only confirmation or
close this version at development no-go. Do not silently mark holdout complete,
change the locked gate, promote a rejected candidate, or invent holdout metrics.
Any agreed workflow clarification must be explicit in the OpenSpec artifacts;
frozen v1 evidence remains unchanged.
