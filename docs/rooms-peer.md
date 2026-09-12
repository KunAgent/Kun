# Peer discussion

New rooms use **Peer discussion** (`peer`). Each enabled member decides whether
it can add a useful answer, correction or handoff. **Coordinator collaboration**
(`autonomous`) and **Directed collaboration** (`directed`) remain available with
their previous behavior. Existing rooms keep their mode; switching the selector
affects new topics, not the protocol already attached to a running topic.

## Starting and continuing a topic

The composer starts a **New topic** by default. Structured `@` selections give
those members a direct response opportunity. With no selection, the default
member responds directly and other members first perform a participation check.
Members can invite enabled peers using structured invitation fields; plain `@`
text in a message does not schedule work.

A reply inherits its source message's `rootRequestId`. Choose **Continue topic**
in the composer or discussion details to add a new user message to that same
topic and open a fresh budget. The continue button focuses the composer; sending
the message performs the continuation. Choosing **New topic** removes the topic
and reply references while keeping the typed message. A successful send resets
the composer to New topic; failed sends retain the draft and retry identity.

Members receive committed messages, valid invitations and important related task
changes. Streaming fragments, logs, typing indicators and idle time do not wake
other members. Empty queues sleep; the runtime does not invent a new topic or
periodically look for work. Separate topics keep independent context revisions
and take turns in the discussion queue.

## Budgets and activity

Each newly started or explicitly continued topic has these fixed limits:

| Counter | Limit | What consumes it |
| --- | --- | --- |
| Member responses | 32 per topic | Every admitted response activation, including retries and stale-context regeneration |
| Responses by one member | 8 per member | The same response activations attributed to that member |
| Participation checks | 128 per topic | Lightweight decisions to respond or remain quiet, including retries |

Member messages, invitations and task events cannot reset these budgets. A
member may decline to respond. Reaching a limit pauses automatic participation
with visible status; already assigned execution tasks keep their own lifecycle.
The configured `smallModel` handles participation checks, with the current main
model as the fallback. A failed check retains pending work and retries with
bounded backoff; it does not automatically become a full model response.

The status summary opens **Room details**. Its discussion section shows actual
member activity, invitations, pending work, waiting/recovery reasons and
remaining response/check allowances. The same drawer contains tasks, request
controls, project agreements and members. Task approval, structured questions,
delivery and integration still target the original execution records.

## Publication, stopping and execution boundaries

`read_room_updates` reads only the host-bound room/topic updates.
`send_room_message` stages one complete public response or an explicit skip;
other members cannot see a staged draft. At turn completion the runtime checks
the topic generation and publication revision. Changed context causes a fresh
judgment before publication. Unrelated topics do not invalidate an answer.
Publication, recipient delivery and processed-inbox acknowledgment are committed
together; replayed receipts do not create another response. Exact duplicate
suppression is not a guarantee against semantically similar answers.

**Stop discussion** invalidates queued work and late results for that topic.
The topic can show **Stopping discussion** until the original execution is
confirmed stopped. Unknown execution keeps its slot instead of being blindly
restarted. Task notifications do not restart a stopped topic; a new explicit
user continuation is required. **Cancel task** remains a separate task action.
Closing the drawer or leaving Rooms does not stop a discussion or execution.

Discussion tools are scoped and read-only. A peer can propose work, but only the
coordinator can submit an execution plan under the actual user's authorization.
A peer message cannot create tasks, modify an existing task, expand repository
permissions or adopt a project agreement. New chat evidence remains reference
material; frozen user authority, repository scope and rule versions remain
separate. There are no member private messages, cross-room memories or timed
self-directed patrols in this version.

## Desktop verification

The macOS arm64 Electron smoke uses deterministic offline model responses through
the real renderer, preload, Main, Manager and Runtime. The complete legacy
regression exercised task creation, protected approvals, structured questions,
rule compression and continuation, immutable review, integration validation,
application and cleanup; its report and 28 screenshots are in ignored
`dist/rooms-peer-final-desktop-smoke/`.

The final focused peer run additionally asserts that the accepted
`send_room_message` body is published exactly, instead of a model's subsequent
completion note. It passed default peer room creation, visible response/budget
state, stop with late publication suppressed, continuation of the same topic,
creation of an independent topic, and zero execution tasks. It produced two
complete member messages without page errors. Its report and six screenshots
are in ignored `dist/rooms-peer-exact-body-smoke/`; screenshots were inspected.
The requested 760px narrow width was constrained by the app to an actual
960 x 780 viewport. The drawer stayed inside that viewport and its overlay
passed the hit-test. This does not establish support below the app's minimum
window width or native-provider conversation quality.

Run all desktop scenarios with `node scripts/smoke-development-rooms.cjs`;
`--peer-only` runs just the scoped peer interaction checks. Avoid changing the
renderer or rebuilding/removing `kun/dist` during a running development smoke.

## Real-model comparison

Status: **pending final recorded comparison**. Unit and deterministic fixture
coverage do not establish real-model conversation quality. The prior native-provider
evidence in [Rooms](./rooms.md#verification-status) covers older flows; the peer
comparison requires its own report before a result can be claimed.

`scripts/eval-room-peer.mjs` uses an already running local Kun HTTP runtime and
its existing configured native models. It does not read configuration files or
provider API keys, start/stop a runtime, or alter provider settings. First check
availability without creating rooms or making model calls:

```bash
node scripts/eval-room-peer.mjs --check --url http://127.0.0.1:18899
```

For authenticated runtimes, provide the local Runtime bearer token through
`KUN_RUNTIME_TOKEN` in the invoking environment. `--token-env` selects a different
environment variable; token values are never accepted on the command line or
included in reports. The check reads `/health`, `/v1/runtime/info` and the local
room preset catalog, and prints only selected model/version metadata.

When ready, run the synthetic comparison:

```bash
node scripts/eval-room-peer.mjs --run --url http://127.0.0.1:18899 \
  --timeout-ms 180000 --evidence dist/rooms-peer-model-eval
```

The script creates separate coordinator and peer rooms with three members, no
authorized repositories, external tools disabled and explicit discussion intent.
It asks a short capacity question, then supplies a correction to the same topic.
It requests a stop after observing six complete member messages, or stops sooner
when the corrected discussion becomes idle, needs attention or times out. The
production 32/8/128 limits are not changed. An external HTTP observer can race
concurrent publication; any observed total above six is recorded as an overshoot
and fails the run rather than being represented as a strict cap success.

Only generated evaluation rooms are stopped and, after confirmed shutdown and
zero tasks, archived. Their messages remain available in the runtime for manual
quality review. Interrupted runs attempt the same cleanup. Reports contain
message hashes and lengths, role/invitation evidence, actual task counts,
response latency, numeric correction signals and reported token usage; they do
not contain raw model text, private filesystem paths or credentials. A task
count other than zero fails the discussion-only check.

HTTP usage coverage includes response and coordinator threads located by unique
evaluation member titles and verified by room ownership. The scoped
`GET /v1/rooms/:roomId/topics/:rootRequestId/metrics` endpoint exposes paginated
participation and publication metrics. The script reports direct triage usage
separately from thread usage to avoid double counting; missing provider usage
remains unavailable, not zero. It also reports publication conflicts and exact
duplicate outcomes when those metrics are available.

This is one sample with coordinator mode first; cache warmth and unrelated
runtime activity can affect latency and cost. Exact repetition and numeric
correction signals are diagnostics, not semantic quality scores. Inspect both
room discussions before drawing a quality or cost conclusion. The metrics
endpoint also records known usage for failed participation checks.

### Native model validation (2026-09-13)

A bounded synthetic comparison ran against the configured native
`deepseek-v4-pro` endpoint in temporary Manager/Runtime profiles. Both modes
completed the question and correction, stopped successfully, created zero tasks,
and produced no exact duplicate messages. Coordinator mode produced six complete
messages; peer mode produced three, with eight participation checks whose usage
was recorded. The personal model-connection registry hash was unchanged.

Both cases used reasoning effort `off` and an output cap of 2048 tokens; the
peer rerun was limited to 32 model calls and used 17. Its baseline was retained
from the preceding isolated native run with the same model and output controls.
This validates the response, correction, stop and usage paths, not general
semantic quality, lower cost or faster completion. Local evidence is written to
`dist/rooms-peer-model-eval-final/report.json` and `isolation.json`.

Earlier attempts are excluded: a localhost proxy changed native reasoning-field
selection, and an isolated small-model override named an unregistered provider.
The valid run preserved the native endpoint and used the isolated runtime's
default model route. These test-harness corrections did not change provider
request semantics or personal provider settings.
