# Commitment follow-up: storage and authority boundaries

## Ownership

`AgentCommitment` remains the strict schema-version-1 user goal. Follow-up does
not add transient execution fields to that object. A Commitment is not a worker,
a recurring goal loop, an application lifetime owner, or an execution permission.

Service Manager is the single physical writer of `rooms.sqlite`. Runtime owns
semantic transitions while it holds the `rooms-coordinator` resource lease. New
follow-up writes, **including old `agent_commitment` writes**, require the current
Runtime participant and fencing token at the Manager boundary. Manager checks
the fence before receipt replay and inside the SQLite transaction. A lost response
may replay the same request; an obsolete Runtime may not use that receipt to
regain mutation authority.

Services await ownership only when admitting a new user mutation. They assert
ownership again before committing. Recovery must not wait its way into a new
lease and continue an old side effect. Read-only projections remain available
when a Runtime is not the current writer.

## Version and rollout fences

- Minimum Manager wire protocol: **7**.
- Required storage capability: **`collaboration-followup-store-v1`**.
- Room SQLite schema: **5**, migrated transactionally from 4.
- Each new document carries `schemaVersion: 1`; its persisted RoomStore revision
  is separate from its logical generation.
- Protocol-5 and protocol-6 discovery readers reject protocol 7. New clients
  reject either old protocol before any business-data request. A current protocol
  without the capability is also incompatible. Manager does not advertise the
  capability when the shared business store is unavailable.
- The migration validates pre-existing sidecars, installs indexes, and changes
  `PRAGMA user_version` in one transaction. Invalid data or ambiguous active
  ownership aborts the migration; nothing is deleted or silently reassigned.
- Existing Commitment JSON, revisions, insertion sequence, request receipts, and
  event scope are unchanged. No tracking, ownership, model-sharing grant, or
  source subscription is inferred from legacy free-text links.
- The data capability is **not** an automatic-execution capability. Runtime's
  follow-up feature defaults off unless explicitly configured. Automatic
  continuation and GitHub observation have separate capability checks. Missing
  receipt, lookup, cancellation, or idempotency support must remain manual-only.

## Documents

The shared store contains narrowly scoped records, not a second scheduler:

| Record | Durable meaning |
| --- | --- |
| `commitment_control` | User tracking intent, monotonic generation and authorization epoch, policy reference, budget ledger, next bounded wake |
| `commitment_link` | Actual typed target, `owned` or `referenced`, provenance, active binding and target stop intent |
| `commitment_subscription` | Authorized resource and event kinds, durable poll cursor/ETag and next due time |
| `collaboration_source` | Provider account/credential **references**, generations, health and authorization barrier; never a token |
| `collaboration_source_grant` | Explicit read scope, expiry/revocation, and separately bounded model/provider/thread sharing |
| `collaboration_event` | Immutable host provenance and provider object revision; external bodies are untrusted context |
| `commitment_event_binding` | Immutable event/goal/purpose/decision-version association with observed input revisions |
| `commitment_execution` | Stable attempt/request identity, phase, permit and authoritative execution receipt |
| `commitment_effect` | Outbox admission key, claim/fence/expiry, retry or reconciliation state, outcome certainty |
| `commitment_attention` | Concrete decision, approval, input, acceptance, or recovery obligation tied to versioned facts |
| `collaboration_policy` | User-evidenced actions and limits, expiry, and fingerprint of the authorized Commitment scope |

`stage` is intentionally absent from persisted control. Runtime derives it from
execution facts and unresolved obligations. A model's completion prose cannot
write an authoritative stage or a source/user permission.

## Transaction invariants

1. **CAS and replay:** Every write names the expected document revision. A
   request ID is replayable only for the original fingerprint. Control absence
   is checked by legacy updates, so concurrent tracking enable cannot be missed.
2. **Immutable identity:** Scope, source identity, event/binding identity,
   admission/request IDs and captured envelope identity cannot be rewritten.
   Generations, epochs, revisions and timestamps cannot move backwards.
3. **One owned executor:** One active Commitment may own a real execution target.
   Thread and Workbench references to that thread share an ownership domain;
   RoomTask aliases are checked against their real execution thread inside the
   write transaction. Changing a live owned task's execution thread is rejected.
4. **Referenced is not owned:** A referenced resource grants no cancellation or
   execution authority. Whole-Commitment stop never traverses referenced targets.
   Cross-room association is not inferred merely because an Agent ID matches.
5. **Uncertain outcomes retain identity:** An unconfirmed dispatch is not an
   ordinary failure. It retains its admission/request identity and may only be
   reconciled. A failure string, stopped flag, interrupted chat turn, expired
   claim or transport timeout does not prove absence of the physical writer.
6. **Authority changes invalidate pending work:** Scope/policy changes advance
   generation and authorization epoch as appropriate. Stop persists its intent
   before cancellation. New admissions must compare these versions again at
   the actual executor boundary; preflight reads alone are insufficient.
7. **Side effects are outside store transactions:** SQLite stores claims,
   permits, intent and receipts. It never invokes a model, provider, process,
   timer-driven execution, or a native approval decision.
8. **Terminal does not mean accepted:** A tracked Commitment cannot be completed
   by a legacy PATCH containing an arbitrary evidence string. Acceptance must
   ultimately consume the current versioned obligation and result facts. The
   store rejects legacy terminal writes without that path.

## User controls

Controls are request-idempotent and revision checked. Enable and policy changes
require a current actual user message in the source room, current membership,
and an unexpired policy. External provider text or a model-authored message
cannot serve as that evidence.

- **Pause:** invalidates pending follow-up admission; preserves tracking history
  and already admitted work. It does not claim to stop an executing process.
- **Resume:** applies only to still-enabled, nonterminal tracking. A changed goal
  fingerprint or expired policy requires fresh explicit authorization first.
- **Disable:** stops further tracking admission without cancelling existing work
  or deleting its history. Resume is not an implicit enable.
- **Stop occurrence:** persists cancellation intent for one execution identity.
- **Stop owned target:** persists intent on that exact active owned execution
  binding. It cannot cancel a referenced target or a non-execution resource.
- **Stop Commitment:** advances the generation and authorization barrier, records
  a legacy-compatible cancelled status, and prevents further follow-up admission.
  Physical work remains `stopping` until authoritative reconciliation proves exit.
- **Reopen:** a separate explicit operation with Commitment and control revisions,
  user evidence and a fresh valid policy. It rejects outstanding effects,
  unfinished execution records, unknown target outcomes, and physical writers
  not proven stopped. It never silently resets accumulated attempt spending.

The old native Workbench confirmation/admission and RoomTask start/retry writes
also inspect the owner control **inside the Manager transaction**. They cannot
queue owned work around a pause, disable, stop, changed scope, or terminal goal.
Untracked work keeps its existing behavior. Service-side checks alone are not
used as the final fence.

## Bounded reads and projection

`collaborationQuery` is a discriminated, strictly parsed set of parameterized
queries: by Commitment; active links/subscriptions/unfinished executions/pending
effects/open attention; due subscriptions; available or expired effect claims;
unknown-effect and execution reconciliation; source subscriptions; unbound
source events; and active ownership. Callers do not send SQL or general filters.

Pages use a bounded limit (at most 100) and tuple keyset cursors with an ID tie
breaker. Mutable `nextPollAt`/retry/update times, rather than immutable insertion
sequence, drive due scheduling. Cursor kinds cannot be mixed. A service allows
at most 30 active links per Commitment. Projection work is bounded and signals
incomplete data rather than inferring completion from a truncated page.

Projection reads metadata and native execution facts, not full conversation
history. It verifies target provenance and physical stop proof. Native
approval/input references are shown only while the actual gate still exists.
`stopping` and `recovery_required` take precedence over completed text. A disabled
source, disconnected Runtime, or missing capability must not be shown as active
automatic follow-up.

## Admission arbitration boundary

Follow-up control and sidecar mutations also require a commit reservation on the
Manager data resource `commitment-followup`. `RemoteRoomStore` obtains it from
the exact Rooms lease owner and Manager connection. Manager checks this
additional fence before receipt replay and again inside the physical SQLite
transaction. A Rooms coordinator token alone cannot mutate these sidecars.
Untracked legacy Commitment writes do not acquire a new authorization requirement.

The lock order is native thread mutation, then follow-up arbitration. Native
admission and local controller registration must occupy the same short
arbitration scope as stop/takeover. Model, provider, GitHub, and external process
work must stay outside it. A Manager-owned physical writer queue additionally
keeps an in-flight persistence operation ahead of later control commits when an
RPC reservation expires during I/O. ThreadStore upsert and revision-CAS now join
this queue at the physical metadata write, after acquiring the existing thread
mutation queue. Manager resolves active ownership through the actual thread,
Workbench, and RoomTask aliases, rather than trusting a native flag in the RPC.
Raw new queued/running turns and queued-to-running promotions on owned targets
require the exact typed target and native request, immutable template fingerprint,
live Manager reservation, and a current, non-revoked native permit. Enqueue also
requires the current dispatch claim; promotion rechecks the durable permit even
if the earlier claim has expired. The generic RoomStore RPC cannot mint that
native permit.

Already-admitted receipt finalization, current-owner running progress, and
cancellation remain writable after stop. Retained native receipt history blocks
restored executable snapshots, including snapshots that omit the history or
arrive after ownership was released. Native authority-bearing input cannot be rewritten
or admission progress rewound; runtime-derived progress such as resolved skills can
still be recorded after the turn starts. Initial admission compares omitted request
fields against the existing thread's inherited execution settings and resolves the
same task/design surface as normal admission. The initial native tier requires the
Kun harness with provider credentials, a pinned or inherited model, and no ungranted
attachment aliases or precomputed gateway/skill grants. Presentation-only prompt
bodies live in the SessionStore, not ThreadStore metadata; initial/promotion input is checked
against the reserved request at its actual start boundary. Promotion additionally
requires the exact completed user item from the validated durable item index;
transient live checkpoints and in-memory projections are not admission evidence.
Prompts are checked in bounded fragments; promotion proof is capped at 256 KiB
UTF-8. If the index is unavailable, Manager schedules its existing index rebuild and
refuses the start; the accepted queued request remains available for reconciliation
under the same identity.

Production permit issuance and the native host callback must still be joined
before automatic execution is exposed. Source-backed native admission fails
closed until the qualified source/grant adapter is present. These Manager HTTP
tests seed a trusted issuer result; they do not claim end-to-end dispatch or
source-authorization coverage.

Commit reservations are resource-scoped: a nested follow-up scope cannot reuse
an enclosing thread commit ID. Same-resource reentry is allowed only for the
same Manager origin and Runtime owner. An incompatible explicit identity, or a
local-only scope trying to become a Manager reservation, fails immediately
rather than waiting behind its own queue entry. Scheduler wakeups strip both
resource and commit contexts.

## Native receiver receipts (PR03 primitive)

Native follow-up uses the existing `TurnService.enqueueTurn` queue, original
thread/workspace and native execution lease. Its host-only options reference the
immutable effect/attempt/admission key; public `StartTurnRequest` does not accept
that authorization. Without the host admission guard or conditional ThreadStore
writes, native follow-up fails closed. The production Workbench/Manager adapter
is a subsequent integration step; this primitive does not enable automatic work.

A bounded `nativeFollowUpRequests` ledger lives in existing ThreadStore metadata,
not a new queue or database. File, hybrid/SQLite and in-memory stores retain its
identities across history rewind, omission and snapshot restore. It holds at most
1,000 receipts per thread and refuses new identities at capacity rather than
evicting a tombstone and making an old request executable again. The native
request fingerprint and logical effect fingerprint are separately immutable.

A preparation revision increases only after verified non-admission. Completion
and negative rollback use metadata CAS; an old negative snapshot cannot override
a newer preparation. A missing visible turn or failed lookup is `unknown`, never
proof of non-admission. `preparing` remains pending until canonical user input is
committed or verified rollback is persisted. A durable execution-start marker
prevents a restored queued snapshot from executing an already-started request.
Ordinary queued edits cannot change a payload owned by an immutable effect.

The host guard wraps queue commit and the promotion CAS/controller installation,
not just a preflight read, and must serialize them against stop/takeover. It is
rechecked when a queued turn is promoted. Receipt lookup does not reconcile or
execute work. Native terminal receipt is a logical result, not proof that every
background process or external harness has stopped; the physical stop predicate
and guarded effect/Runtime lifecycle still have to supply that proof.

## Verification entry points

- `kun/src/contracts/collaboration-followup.test.ts`: strict document/envelope
  contracts, bounds and provenance separation.
- `kun/src/rooms/room-collaboration.test.ts`: SQL queries, tuple pagination,
  identity immutability, claims, ownership and receipt invariants.
- `kun/src/rooms/room-collaboration-migration.test.ts`: real v4 schema fixture,
  repeated startup, exact legacy JSON/receipt preservation and rollback.
- `kun/src/manager/remote-room-store.test.ts`: real router/remote-store mutation
  fence, stale participant rejection, transactional receipt replay, and missing
  or expired admission-arbitration reservations.
- `kun/src/manager/data-mutex-context.test.ts` and `data-mutex.test.ts`: nested
  resource commit scoping, exact identity reentry, and wake-context stripping.
- `kun/src/manager/manager-memory-compatibility.test.ts`: real client with frozen
  protocol-5/protocol-6 discovery readers and capability mismatch checks.
- `kun/src/agents/followup/service.test.ts`: explicit controls, user evidence,
  release switches, old PATCH races and reauthorization.
- `kun/src/agents/followup/legacy-boundaries.test.ts`: real SQLite/native link
  writes, physical thread aliases, old API bypass prevention and stop proof.

- `kun/src/services/native-followup-admission.test.ts`: stable request identity,
  pending/canonical-input recovery, lost responses, negative proof CAS, stale
  snapshots, clock rollback and host-guard promotion/stop interleavings.
- `kun/src/services/native-followup-module-order.test.ts`: receiver-first and
  service-first module initialization without an installation cycle.
- `kun/src/adapters/native-followup-receipts.test.ts`: real file/hybrid SQLite
  persistence/reopen, conditional writes, retention and bounded tombstones.

These tests verify the storage/control and native receiver primitives. They are
not evidence of a production GitHub run, automatic continuation, UI acceptance,
or a completed cross-adapter lifecycle experiment. Those require the production
execution/source adapters and end-to-end evidence in addition to these invariants.
