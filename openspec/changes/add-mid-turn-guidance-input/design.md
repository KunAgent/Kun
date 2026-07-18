## Context

The renderer already stores messages submitted during a running turn in `queuedMessages`, shows them above `FloatingComposer`, and starts each one as a new turn after the current turn settles. Kun already exposes `POST /v1/threads/{threadId}/turns/{turnId}/steer`; `SteeringQueue` is drained before native model steps and converts accepted entries into persisted user items. The missing pieces are an explicit renderer action and a terminal-boundary guarantee: guidance accepted while a final model response is streaming can currently be cleared when that response ends without another model request.

The implementation must keep the single `Renderer -> preload -> main -> kun serve` runtime boundary, must not add a renderer-side agent loop, and must preserve ordinary queued-message behavior for messages the user does not guide.

## Goals / Non-Goals

**Goals:**

- Present queued input as compact, readable rows above the composer with explicit Guide and Remove actions.
- Let the user move an eligible queued text message into the running turn without interrupting it.
- Persist accepted guidance as a user message before the next native model request.
- Guarantee that accepted guidance is either processed by another model request or rejected before ownership transfers from the renderer queue; it must never be silently cleared.
- Preserve queued messages and surface an error when steering is unavailable, ineligible, full, or loses a completion race.

**Non-Goals:**

- Automatically steer every message submitted while busy.
- Reorder queued messages, add an overflow menu, or change composer attachment behavior.
- Inject attachments, file references, design/write structured contexts, or plan turns through the text-only steer contract.
- Add another HTTP endpoint, IPC bridge, runtime provider, or settings surface.
- Add live mid-query input transport to delegated Agent SDK providers; a steer request not accepted by an active native boundary remains queued for normal next-turn delivery.

## Decisions

### Keep queueing as the default and make guidance explicit

Submitting while busy continues to create a renderer-owned queued message. A Guide button on an eligible row calls a new store action with that message id. This keeps the existing mental model and lets the user choose between “use this to redirect the current work” and “send this as a separate follow-up.” Automatically steering all busy submissions was rejected because it changes turn semantics and can make independent follow-up requests unexpectedly alter current work.

### Reuse the existing Kun steer route

The store resolves the active thread and turn, then calls the provider's existing `steerUserMessage`. The queued entry is removed only after the request succeeds. The provider forwards optional display text so the persisted user item can retain the user-facing copy. A rejected request leaves the row untouched and records a renderer error. No shared IPC or HTTP schema is added.

### Limit Guide to payloads the steer contract can preserve

Guide is enabled only for non-plan queued messages that contain text without attachments, file references, extension composer contexts, write context, or structured design/plan context. Ineligible rows still retain ordinary queued-send and remove behavior, and expose localized disabled guidance. This prevents a text-only steer call from silently dropping structured input.

### Seal a native steering queue at terminal boundaries

`SteeringQueue` gains a terminal seal operation. After a native model step reports `stop`, the loop attempts to seal the turn only if no steering entries are pending. If entries are pending, the loop continues; its next iteration drains them into user items before invoking the model again. Once sealed, new enqueue attempts are rejected, so a message racing with finalization remains in the renderer queue and can be sent as the next turn. Clearing terminal runtime state removes both buffered entries and the seal.

This handshake is preferred over an extra best-effort drain because a drain followed by completion still has a window in which the server could accept an entry and then clear it.

### Keep pending-row async state local to the presentation

The queued-row component tracks ids whose Guide request is in flight, disables duplicate actions, and shows a spinner. Store state remains the source of truth for message ownership; successful guidance removes the row, while failure leaves it in place. No persisted migration is needed because `queuedMessages` is renderer-ephemeral.

## Risks / Trade-offs

- [A turn reaches its configured model-step limit immediately after guidance is accepted] -> The guidance is persisted before the limit failure, and the existing explicit limit error is emitted instead of silently discarding input.
- [A turn completes while the user clicks Guide] -> The terminal seal makes the server reject late guidance; the renderer keeps the message queued for normal delivery.
- [Structured queued content appears steerable] -> Eligibility is checked in both the row model and store action; the store is the authoritative guard.
- [Multiple Guide clicks race] -> Per-row pending state disables duplicate submissions, while Kun's bounded queue remains the server-side capacity guard.
- [Delegated Agent SDK turns do not consume the native steering queue] -> The feature does not claim SDK live steering; rejected/unavailable guidance remains queued. Native Kun model turns receive the full guarantee.

## Migration Plan

No data migration is required. The change is additive and reuses the existing route. Rollback consists of removing the Guide action/store method and terminal sealing logic; ordinary queued-message delivery remains compatible.

## Open Questions

None for this scope. Attachment-aware and delegated-SDK live steering can be specified separately if product requirements expand.
