# Conversation Agent dispatch

Code main conversations and private assistant Code task handoffs share one
host-owned dispatch decision. Configured, enabled and ready conversation Agents
can execute work. External main Agents coordinate through their working Kun tool
bridge; execution stays behind `kun serve`.

## Permission behavior

| Source permission | Dispatch card | Execution tools |
| --- | --- | --- |
| Ask for approval | Wait for a user decision | Existing user approvals |
| Approve for me | Review the concrete assignment and start immediately on allow | Existing automatic review |
| Full access | Start after a 60-second intervention window, or on Start now | Existing automatic handling within scope |

The countdown applies once to a dispatch or batch. It does not delay each command
or file edit. Schedules and unlimited goals retain their dedicated confirmation
flow. Existing plan-to-build behavior is unchanged.

The source permission controls the start decision. The displayed effective task
permission reflects applicable native/profile limits. Task authority intersects
the accepted source snapshot, live restrictions, and the execution Agent's native
permission ceiling. A recommendation cannot widen authority.

Ordinary delegation defaults on for new Code tasks and no longer requires the
advanced ADE switch. Explicit task/project restrictions and ambiguous historical
settings remain authoritative. Workers and generic delegated children cannot
create teams recursively. Advanced racing retains its ADE policy.

## Durable dispatch intents

`AgentDispatchService` owns the decision, timer, startup claim and adapter
reconciliation. `FileAgentDispatchIntentStore` writes through the shared Manager
data plane to `agent-dispatch/intents.json`; clients do not maintain a second
canonical writer. Unchanged polling skips physical writes.

An intent records source thread/turn/tool-call identity, the application session,
the recommendation and accepted policy, a revision, stable startup identity,
deadline, decision, execution target, and bounded replay metadata. Public views
exclude the opaque execution payload, original user excerpt and request ledger.

During review or countdown no Agent process or task workspace is created.
Approved startup is atomically claimed, then handed to the existing scheduler.
Partially admitted batches use deterministic worker/dispatch IDs; restart
reconciliation resumes missing work without rerunning admitted assignments.

Pause takes effect in the host before the card becomes editable. Saving restarts
the full-access window or automatic review. Immediate start, deadline, cancel,
editing and takeover race through revision checks and idempotent request IDs.
Cancellation after admission stops the exact target. Takeover applies the
existing user ownership transition and suppresses automatic continuation.

Runtime replacement within one application session retains deadlines. Reopening
the application renews an unstarted full-access window. Application exit stops
the coordinator and drains callbacks. Old historical cards are not converted
into new automatic dispatches. Forked/history views cannot control another
conversation's intent.

## Public controls and events

- `GET /v1/agent-dispatch-intents?threadId=<id>` lists conversation intents.
- `GET /v1/agent-dispatch-intents/:id` returns one public intent.
- `POST /v1/agent-dispatch-intents/:id/actions` accepts `action`,
  `expectedRevision`, and `requestId`, with bounded recommendation edits.
- Actions are `start_now`, `pause`, `update`, `resume`, `cancel`, and `takeover`.
- Mutations require the runtime user token; model gateway credentials cannot
  control cards. HTTP cannot supply execution payloads or permission snapshots.
- `agent_dispatch_intent` events replay through the source thread SSE. The
  original turn identity lives in the intent source, so later parent turns do
  not invalidate host-authored progress events.

Main Agents can inspect their own cards with `dispatch_intent_status` and cancel
them with `dispatch_intent_cancel`, including before worker IDs exist. These
tools do not let a model bypass the user's intervention window.

## Results and replacement

The same card follows dispatch, queueing, execution, parent review and settlement.
Workers retain the existing inspector, stop and takeover controls. Main Agents
continue independent work or finish their turn and wait for a durable notice;
they do not poll the model loop while a timer runs.

Outcome continuations preserve the exact source route, account, credentials and
client surface, with authority intersected against current restrictions. Results
remain reference data until the main Agent checks the assignment and records its
verdict. A card stays awaiting parent review while that continuation is pending.

An automatically selected failed Agent can be replaced once. The previous
executor must be proven stopped and its workspace inspected first. Replacement
preserves the card identity, uses a new stable startup identity, records its
reason, and repeats the applicable permission decision. User-pinned Agents,
cancelled work and user-controlled work cannot be replaced automatically.

## Validation

Feature tests cover the permission matrix across both entrypoints, native and
external coordinators, batch deadlines, concurrent controls, restart adoption,
permission revocation, Manager persistence, scoped controls, and replacement.
Renderer tests and `scripts/smoke-agent-dispatch.mjs` exercise production cards,
including narrow windows, scaled display, editing and synchronous double clicks.
The UI smoke is explicitly a fixture, not provider authentication evidence.

Installed-client offline wiring tests use isolated configuration, a local mock
upstream and a deny proxy. They verify protocol/tool roundtrips and configuration
restoration separately from live account entitlement, quota or paid inference.
