# Room run inspection

Rooms can open an exact agent attempt from a message's **View this run** action,
the member's **View current run** action, member history, or a task's run list.
The existing details drawer shows the trigger, original requirement, recorded
conversation/tool items, outcome, elapsed time and available usage. Tool payloads
and supplemental prompts start collapsed. **Open this run in Code** hydrates and
scrolls to the recorded `threadId` and `turnId`; missing history produces an error.
Participation checks have their own history entries but no synthetic Code thread.

The drawer is read-only. Approvals, questions, retries, task changes, recovery and
delivery application remain in their existing controls. Viewing never calls a
model, changes discussion budgets, retries a queue admission or rewrites history.
It does not depend on raw model-request capture or change capture settings.

## Identity and persistence

`RoomRunRecord` is stored as `room_run` in the existing Manager-owned Rooms SQLite
store. A deterministic ID binds room and durable queue request identity; triage
uses a separate ID. Runs and immutable input snapshots exist before admission.
The existing Manager capability handshake requires `room-store-v4` and
`item-turn-page-v1`, so older Managers use the normal authenticated upgrade path
instead of receiving unsupported document kinds or pagination options.
The original client request is reconciled after an uncertain queue response;
an absent uncertain execution remains `recovery_required` instead of re-enqueuing.

The record retains member, topic, request, phase, attempt/predecessor, source,
confirmed session identity, lifecycle, publication outcome and available usage.
Peer budget/activation, skip/failure/cancellation and publication transactions
retain the corresponding run result. Native coordination, discussion, execution,
review and integration turns use the same recording helpers.

Agent messages can carry `originRunId`. Runtime publication attaches it and updates
the run within the message transaction. Public send requests cannot set it, and
neither a message's origin nor a run's confirmed identity can be reassigned.
Task state notices continue to refer to tasks rather than claiming a model origin.

## Read API and bounds

All these routes authenticate through the existing Rooms boundary:

| Route under `/v1/rooms/:roomId` | Result |
| --- | --- |
| `GET /runs` | Creation-sequence page; topic/member/task/request/phase/status filters |
| `GET /runs/:runId` | Metadata, input, source and availability |
| `GET /runs/:runId/items` | Exact-turn items, newest page with chronological ordering |
| `GET /runs/:runId/items?item_id=...&content_offset=...` | Up to 8 Ki characters of one recorded field |
| `GET /runs/:runId/events` | Scoped SSE or a bounded JSON invalidation page |
| `GET /messages/:messageId/run` | Recorded origin or conservative historical resolution |

The service validates room/member/topic/task/turn ownership from durable records.
Clients cannot substitute a thread ID. SessionStore applies the turn filter before
item count/byte pagination. Normal pages default to 40 items and 128 KiB; large
payloads retain a bounded preview and can be expanded separately. File reads use
the existing index or a streaming fallback, never `loadItems`, compaction or repair.

SSE carries compact invalidations rather than arbitrary tool event bodies. Its
cursor combines run revision and thread event sequence. Snapshot boundaries are
captured before metadata/items; the renderer merges both snapshot cursors using
the lower bounds. The stream scans bounded replay pages, ignores other turns,
handles oversized records by refreshing the bounded projection, and stops when
the drawer closes. Navigating between runs cancels old requests and subscriptions.
Historical views never follow a member's newest run. Reader scroll position and
unloaded gaps are preserved while the latest page refreshes.

Legacy resolution does not write migrations. Only exact saved discussion/metric/
request/task identities establish a virtual historical run. An ambiguous source
is labelled unavailable; known identities whose sessions or turns were removed
keep their identity and display the missing-content reason.

## Validation

Unit tests cover durable admissions, replay, failed metrics after publication,
source spoofing, skipped/stale/cancelled attempts, pagination, content fragments,
scope isolation, no read-side writes, snapshot races, SSE reconnect and navigation.
The managed runtime integration uses a real Manager and native Kun queue with an
offline model fixture. The Electron acceptance command is:

```sh
npm run typecheck
npm run build
node scripts/smoke-development-rooms.cjs --ui-visual --evidence dist/rooms-run-inspector-smoke
npm run check:file-lines
```

The smoke includes live activity entry, cancelled and triage history, old-message
origin, tool expansion, themes/narrow windows, exact Code turn visibility and
zero model calls caused by inspection. Do not rebuild or modify renderer sources
while the Electron smoke is running.

### Recorded acceptance (2026-09-13)

The final offline Electron run passed against a real isolated Manager and Kun
queue, including task execution, protected approvals, structured questions,
fixed-delivery review, integration, recovery and cleanup. It retained 53
screenshots with no uncaught renderer errors. Two task state notices were
verified to keep task links without a run action. Live and historical run views
each opened and closed one scoped subscription and issued zero mutating runtime
requests; the model call counters did not increase from inspection. The exact
historical Code turn was selected and visible in the viewport.

Local evidence: `dist/rooms-run-inspector-final-smoke/report.json`. Generated
reports and screenshots are not source artifacts. Typecheck, the complete build,
the final Kun build, relevant unit/managed integration tests and the file-size
gate passed. Scoped ESLint had no errors; the existing timeline hook retains its
two pre-existing dependency warnings.
