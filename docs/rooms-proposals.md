# Room proposals

Room proposals are agent-drafted action cards. They encode one structural
change an agent wants to suggest — pin an agreement, request an execution, add
a member, or create a new agent — and render it in the room timeline as a card
the user can review.

The authorization boundary is absolute: **agents may draft proposals, but only
the user can confirm and execute them.** The agent tool is data-only and never
performs the requested action; adoption always re-enters the existing
user-scoped mutation paths and then records the resulting durable artifact on
the card.

## Contract

`kun/src/contracts/room-proposals.ts` defines the durable record. A proposal
has one of four payloads:

| Payload | Result reference required to commit |
| --- | --- |
| `pin_agreement` | `rule`: the rule created by pinning the proposal message |
| `execution_request` | `message`: a newer user-authored message carrying the request |
| `add_member` | `room`: the same room, now containing the proposed agent as an enabled member |
| `create_agent` | `agent`: an agent identity created after the proposal |

Statuses are `open`, `committed`, `dismissed` and `withdrawn`. Only `open`
proposals can be resolved. Resolution requires the expected document revision
(compare-and-swap), so a stale card can never overwrite a concurrent decision.
Create and resolve share the room interaction receipt/fingerprint machinery, so
retried requests replay their first accepted result instead of applying twice.

## Creation

`createRoomProposal` (`kun/src/rooms/room-proposals.ts`) validates the payload,
verifies the author is an enabled member, enforces per-run and per-room open
limits (`ROOM_PROPOSAL_RUN_LIMIT = 2`, `ROOM_PROPOSAL_ROOM_OPEN_LIMIT = 20`),
then commits two documents atomically:

1. the `room_proposal` record;
2. a presentation `message` with `presentationKind: 'proposal'`, `proposalId`
   and `status: 'final'`.

Creation is presentation-only: it does not wake members, write `peer_inbox`,
create tasks, or consume budget. Events are `message.presentation.created` and
`room.proposal.updated`; memory capture explicitly skips proposal cards because
a draft is not yet a fact.

## The `propose_room_action` tool

`kun/src/rooms/room-proposal-tool.ts` advertises `propose_room_action` only
inside room discussion/conversation steps (`roomAgent` contexts). Identity is
host-bound: the room, member and run are derived from the thread's room context
and the current peer activation (with the same freshness check as
`send_room_message`) — never from model arguments. The tool requires the
`proposals` agent feature flag (and `identities` for `create_agent`), validates
payload references against the live room, and returns an explicit note that the
submission is only a draft awaiting user confirmation. Its client request id is
derived from the run and tool call, so a retried call replays the same draft.

When a run is cancelled or its topic is stopped, `withdrawRunProposals` marks
that run's still-open proposals `withdrawn` (`run_cancelled` / `topic_stopped`).
Drafts from runs that merely went quiet stay open; only the user resolves them.

## Resolution

Resolution is bound to the HTTP route, not to any agent tool:

- `GET /v1/rooms/{roomId}/proposals/{proposalId}` — read a proposal.
- `POST /v1/rooms/{roomId}/proposals/{proposalId}/resolve` — user decision with
  `{ clientRequestId, expectedRevision, decision: 'committed' | 'dismissed',
  resultRef? }`.

A `committed` decision must carry a `resultRef` matching the payload kind, and
`resolveRoomProposal` re-validates the referenced artifact inside the same
transaction: the rule must point at the proposal message, the execution message
must be user-authored and stored after the draft, the proposed agent must be an
enabled member, and the created identity must postdate the proposal. A
mismatch, stale revision or non-open status returns a conflict.

## Renderer

`RoomProposalCard` (`src/renderer/src/components/rooms/RoomProposalCard.tsx`)
is dispatched from `RoomMessageRow` whenever a message has
`presentationKind: 'proposal'`. It shows the payload fields, author, rationale
and status (including the withdrawn reason), refreshes on room events, and
offers only explicit user actions:

- `pin_agreement`: edit the agreement text, pin the card message through the
  existing rule endpoint, then commit with the new rule id.
- `execution_request`: populate the composer through the
  `kun-room-proposal-draft` window event (goal, mentions, repository, topic,
  `execute` intent) and arm the card; when the user's resulting message lands,
  the card commits with that message as the result reference.
- `add_member`: open the existing member editor prefilled with the proposed
  agent, apply the member update through the normal room patch, then commit.
- `create_agent`: open the existing agent profile form prefilled from the
  draft, then commit with the created identity.
- Any open proposal can be dismissed with an expected-revision resolve.

Nothing auto-executes: the tool never performs the action, and the card only
commits after the user's own request produced the durable artifact.
