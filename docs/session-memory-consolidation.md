# Session memory consolidation

Session consolidation turns old archived threads into compact `episode` memory
records and then reclaims the original thread payload. It is a session-layer
feature: it uses the existing MemoryStore public API and does not change
MemoryRecord fields or memory-store internals.

## Safety defaults

The feature is disabled by default. The recommended first rollout is:

```json
{
  "capabilities": {
    "memory": {
      "consolidation": {
        "enabled": true,
        "tier": "tier-1",
        "reclaimMode": "safe"
      }
    }
  }
}
```

`tier-1` keeps the thread and trims its consolidated history. `tier-2` deletes
the whole thread through the normal thread lifecycle and must be explicitly
selected. `safe` retains a checksummed recovery copy until `archiveTtlMs`;
`reclaim-now` is irreversible and should only be used after validation.

Configuration is frozen into each job. Later configuration changes do not turn
an existing safe Tier-1 job into a Tier-2 or immediate-reclaim job.

## Candidate rules

A thread must be archived, idle, larger than `minBytes`, have a completed turn,
and have no queued/running turn, pending approval, pending user input, pin, or
fork dependency. Idle age uses the last completed turn's `finishedAt`; an old
`updatedAt` alone never makes a thread eligible.

## Preview and execution

The authenticated runtime routes are:

```text
GET  /v1/memory/consolidation/preview
POST /v1/memory/consolidation/run
```

Preview is read-only and reports candidates, exclusion reasons, per-thread
payload bytes, projected bytes, and episode previews. Run is bounded by
`maxThreadsPerRun` and is coalesced with the background maintenance task.

The execution path is:

```text
select -> summarize with the configured model -> write episode -> verify
  -> persist checkpoint -> trim/delete -> measure payload bytes -> complete
```

The summary step uses a model. Filtering, evidence hashing, checkpointing,
revision checks, deletion, recovery verification, and byte accounting are
deterministic. A failed model call, failed filter, missing `createWithId`,
changed source revision, or failed verification leaves the raw thread intact.

## Memory authorization

The automatically written record is a low-authority `episode` reference. It
contains a bounded summary plus source excerpt and content hash so the evidence
remains self-contained after raw history is removed. Durable facts, preferences,
and decisions continue through the existing approval queue and do not gate
episode reclamation.

## Recovery and limitations

Tier-1 safe recovery uses an in-thread checksummed snapshot. Tier-2 safe recovery
copies the canonical thread files to `consolidation-recovery/<jobId>` before the
thread lifecycle deletes the source. The current MVP verifies and retains these
copies but does not expose a user-facing restore route; recovery is an operator
and follow-up implementation concern. Attachment cleanup remains owned by the
existing generation-safe maintenance sweep.

The reported `spaceReclaimed` value is only the measured thread-directory
payload delta. SQLite index-row deletion is logical cleanup and is not counted;
v1 does not run `VACUUM` or claim data-root index shrinkage.

For operational rollout, start with preview, then Tier-1 `safe` on a small
`maxThreadsPerRun`. Keep Tier-2 and `reclaim-now` disabled until real recovery
and attachment scenarios have been validated.
