# P3-B development review

## Outcome and scope

The frozen `p3-feedback-tiebreaker-v1` development grid has no eligible feedback
candidate. The contributor closes this version at development no-go; there is no
decision-grade holdout result, and no holdout metric is part of this decision.
The lock selects `foundation-control` because the pre-registered selection rule
uses it as the fallback. A valid lock is not a passed decision gate.

Production ranking, canonical Memory, and frozen P3-A evidence are unchanged.

## Holdout review and correction

An independent Opus 4.8 review confirmed the frozen inputs and lock without reading
holdout labels or results. Its development-label assessment was summary-report based,
not a per-case label audit. A historical foundation-control run exists, but it was
later found to have been executed repeatedly in temporary output directories and to
have incomplete gate measurement. See `holdout-execution-audit.md`; it is not
decision-grade holdout evidence. No production ranking path was changed. Even a
future go would require a separate production-integration change.

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

## Final decision and holdout limitation (2026-09-23)

An independent Opus 4.8 review confirmed the candidate lock, frozen input hashes,
development summary, and pre-registered fallback without reading holdout labels
or results. That review authorized a run but did not audit the later runner and
does not certify its execution. The subsequent execution audit found repeated
temporary-directory scoring and incomplete gate measurement. The historical
output is therefore retained only as a record of the flawed execution, not as a
holdout decision.

The contributor closes v1 at the development no-go rather than rerunning the
retired version. This is an explicit deviation from the original one-holdout
plan; it does not convert the development result into a holdout result. The
selected fallback is an unchanged control, and every feedback candidate failed
the zero-explicit-forbidden-selection gate on development. No gate was relaxed,
no frozen data was edited, and production ranking remains unchanged. A future
attempt must use a new decision version and independently reviewed execution
controls.

During an earlier source review, some holdout label text appeared in search
output; no holdout metrics were computed and no parameters were tuned. That
review is not represented as holdout-label-blind. This limitation remains part
of the audit trail.

## Label review limitations (2026-09-17)

The frequent-unconfirmed development control labels package lint forbidden while
package validation is expected, although both active records answer a broad
package-check query and neither has explicit confirmation/correction evidence.
The misleading-feedback control labels three review passes current while the
two-pass record is active, confirmed and has higher importance. Such cases can
expose the limits of feedback, but require acknowledging that a bounded
tie-breaker lacks evidence to infer the hidden label and must also preserve
neutral ordering. Absolute zero-forbidden selection is still the frozen rule;
this review does not relax it or relabel examples to pass.

These limitations constrain interpretation of the development rejection; they
do not invalidate or rewrite its recorded numbers. A later independently
reviewed dataset would need a new version, not edits to these frozen inputs.
During source review, some holdout label text appeared in search output. No
holdout metrics were computed and no parameters were tuned. Nevertheless, this
review is not holdout-label-blind or an independent approval of the author's
implementation. Obtain a separate review before resolving task 4.6.
