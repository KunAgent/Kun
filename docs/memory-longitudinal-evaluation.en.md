# Longitudinal memory behavior replay

## Method and limits

This is a deterministic storage-and-tool replay, not a live-model quality benchmark.
The checked-in anonymous scripts exercise sequential user intents against real runtime
classes. Expected outcomes are hand-authored invariants, not model judgments. The same
scripts ran against source extracted from baseline commit
`a6382c8b539ab1b0e66190f3a63d484e95f626d4` and the upgraded working tree, using the same
installed dependencies and machine. No historical behavior is emulated in an adapter.

The fixtures cover correction and rollback, temporary preference expiry, symlink/worktree
project continuity, branch isolation, foreign/private-agent scope checks, denied directive
promotion through `LocalToolHost`, forgotten-content recapture after restart, applying
candidate recovery after forgetting, simultaneous compare-and-swap edits, enumeration,
and complete serialized JSON budgets. Both variants use the existing lexical ranking.
The replay fixes memory timestamps; Git fixtures are temporary local repositories.
No production data, credentials, or external model requests are used.

Files:

- `kun/src/memory/memory-longitudinal-evaluation-fixtures.ts`: scripts and acceptance gates
- `kun/src/memory/memory-longitudinal-evaluation.ts`: identical real-runtime scenario runner
- `kun/src/memory/memory-longitudinal-evaluation.test.ts`: upgraded gate and optional baseline comparison

## Recorded local result

Run date: 2026-10-06 UTC. This one local pass is a regression result, not a statistical
estimate of user task success. All previously passing baseline gates remained passing.

| Gate | Baseline | Upgraded |
| --- | --- | --- |
| Corrected body is the sole active recall | Pass | Pass |
| Prior correction version can be inspected and rolled back | Fail | Pass |
| Temporary preference disappears after expiry | Pass | Pass |
| Approved project knowledge follows symlink/worktree identity | Fail | Pass |
| Branch-local facts stay local | Pass | Pass |
| No unrelated-project/private-agent scope leakage | Pass | Pass |
| Denied promotion cannot turn injected text into a directive | Pass | Pass |
| Forgotten content cannot be recaptured under a new ID after restart | Fail | Pass |
| Forgotten applying candidate is absent after pending recovery | Fail | Pass |
| One of two same-revision edits is rejected | Fail | Pass |
| Enumerate all 60 IDs once within the output budget | Fail | Pass |
| Oversized list/search JSON stays within 12,000 characters | Fail | Pass |

- Deterministic gates passed: 5/12 baseline; 12/12 upgraded
- Enumeration: 50/60 IDs in one baseline page; 60/60 IDs across two upgraded pages
- Maximum complete serialized tool response: 250,006 baseline; 11,824 upgraded characters
- Oversized-record case alone: 250,006 baseline; 4,276 upgraded characters
- Forgotten active records after recapture: 1 baseline; 0 upgraded
- Forgotten applying candidates after recovery: 1 baseline; 0 upgraded
- Concurrent accepted edits from the same version: 2 baseline; 1 upgraded
- Measured scenario latency sum: 255.48 ms baseline; 476.43 ms upgraded
- Per-scenario latency p50/p95: 11.44/127.11 ms baseline; 24.70/187.77 ms upgraded
- Model requests/tokens/API cost: 0 / 0 / USD 0 in both variants

Latency includes local filesystem mutations, Git identity resolution, and the different
amount of completed work (for example, two complete pages versus one incomplete page).
It excludes fixture Git setup and module loading. These single-pass timings are diagnostic,
not a speed comparison or an end-to-end model latency claim. Compute cost is not measured.

The broader focused regression tests additionally cover 60/600 records at limits 1, 20,
and 50; mixed lifecycle states, filters, and timestamp ties; binary mixed-case ID ordering;
empty first-500 windows; lossless escaped-content chunks; topic-to-ID-to-read discovery;
and project identity with File, FTS5, and deliberately degraded SQLite stores.

## Reproduce

The ordinary test command always asserts every upgraded gate. The baseline comparison
is optional because shallow CI checkouts may not retain the historical commit. To compare
against the exact baseline rather than a manually reconstructed approximation:

```bash
set -eu
repo="$PWD"
baseline="$(mktemp -d)"
trap 'rm -rf "$baseline"' EXIT
commit=a6382c8b539ab1b0e66190f3a63d484e95f626d4
git cat-file -e "$commit^{commit}"
git archive "$commit" kun/src kun/package.json | tar -x -C "$baseline"
ln -s "$repo/kun/node_modules" "$baseline/kun/node_modules"
cd kun
KUN_MEMORY_BASELINE_ROOT="$baseline/kun" \
KUN_MEMORY_REPLAY_REPORT=/tmp/kun-memory-longitudinal-results.json \
../node_modules/.bin/vitest run src/memory/memory-longitudinal-evaluation.test.ts
```

The JSON report contains case-level decisions, counts, local latency, and budget sizes;
it intentionally omits fixture paths and memory contents. The source snapshot is temporary
and is not a second branch or committed vendor copy.

## Live-model outcome evaluation remains open

This replay does not establish improved reasoning, personalization, semantic recall, or
same-model task-success rates. No model route or credentials were consulted. A separate,
authorized live experiment must lock provider/model version, prompt/task corpus, tool
policy and token budgets, use identical multi-turn tasks on each version, and score final
task outcomes with blinded rubrics and repeated runs. It should report uncertainty,
latency, token/API cost, correction accuracy, stale-memory use, and privacy failures.
Zero scope leakage and zero unapproved directive promotion remain hard safety gates.
