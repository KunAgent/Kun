# Rooms initialization and IM conversations

The Rooms workspace combines a durable starter team with one mixed conversation
sidebar. It uses the existing Kun Runtime, Manager, peer discussion queue,
Agent memory scopes and reviewed task pipeline.

## Starter team

A fresh profile creates coordinator, researcher, designer, developer and reviewer
identities on the first Rooms visit. Each gets one private conversation; all five
join My Team. The coordinator conversation opens once. Subsequent visits retain
the selected conversation and its draft.

Template IDs identify jobs independently of execution roles. Researcher and
designer use the existing developer execution role and general preset, while
all discussion turns remain read-only. The starter developer has a separate
reviewer. No repository or external connection is assigned by initialization.

Migration records whether the data space was initially empty, without creating
starter identities itself. Legacy room members still migrate individually.
Existing profiles receive a dismissible setup preview. Only exact legacy default
IDs or saved onboarding bindings suggest reuse; matching names never merge
identities. Reused Agents keep their configuration, and archived Agents are not
restored automatically.

The identity records, five private conversations, team group and completion
marker share one fenced transaction. Request fingerprints and stable IDs make
retries and lost acknowledgements safe. A completed team is not recreated on
restart, including after its Agents or conversations have been archived.

Welcome cards are renderer content, not Agent messages. Their examples populate
an empty draft and focus the composer without overwriting existing text. They do
not create messages, unread state, memory jobs, requests or model calls.

## Sidebar and messages

Private Agent conversations and groups share one server-paged list. A durable
Agent with no private conversation yet is represented by the same stable sidebar
key it will use after its conversation opens. Collaboration transcripts remain
available through the type filter.

Queries filter and order the combined rows before pagination. Cursors bind the
filter scope. Recency uses complete messages, not streaming drafts or profile
edits. Loaded pages are revalidated after relevant events and navigation, which
also covers initialization preceding the initial SSE subscription cursor.

The sidebar keeps search, type/status/repository filters, pin/archive actions,
unread and attention indicators, and virtual scrolling. Agent management and
user-avatar settings are available from the footer. Code and Work navigation
are unchanged.

Rooms use a single IM presentation: user bubbles and avatars on the right,
Agent bubbles and avatars on the left, with left-aligned text inside both.
System notices remain neutral. Peer transcripts never render an Agent as the
user. Main timelines and reply drawers reuse the same message row. Legacy
thread-layout preferences normalize to bubble layout; saved widths and link
preview preferences remain intact.

## User avatar

The bundled waving Kun is the default user avatar. A profile can select one of
the existing built-in portraits or upload PNG, JPEG or WebP images up to 2 MB and
16 megapixels. Crop position is adjustable in a square preview. No upload occurs
until Save. The existing upload service verifies and normalizes the result to
128 by 128 pixels and registers durable room_avatar ownership.

The local Rooms user profile stores only a validated avatar reference. Its
versioned update emits a presentation event; it does not alter conversations,
message attribution, discussion versions, memory or budgets. Historical user
messages render the current avatar. Missing uploads fall back to the mascot.
Cancel retains the saved avatar; resetting changes only the reference. Shared
avatar assets are not deleted when a profile changes.

## Interfaces

- GET /v1/agents/templates includes template IDs, versions and examples.
- GET/POST /v1/agents/onboarding queries and commits team setup or dismissal.
- GET /v1/rooms/sidebar returns a bounded mixed conversation page.
- GET/PUT /v1/rooms/user-profile reads and updates the current profile avatar.
- Existing /v1/rooms/avatars endpoints store and resolve portrait assets.

Manager advertises rooms-init-im-v1. The shared contracts and constrained desktop
bridge expose these APIs through window.kunGui. Existing room-list callers still
receive groups unless they explicitly request another kind.

## Validation

Focused tests cover atomic initialization and retry, exact identity reuse,
shared execution roles, mixed keyset pagination, streaming exclusion, archive
and unread filters, versioned user-avatar updates, mascot fallback and stale
presentation updates. Existing Rooms, Agent, memory and bridge tests cover the
preserved execution boundaries.

The offline Electron entry is:

```sh
npm run build
node scripts/smoke-development-rooms.cjs --init-im-only --evidence dist/rooms-init-im-smoke
node scripts/smoke-development-rooms.cjs --with-agents --ui-visual --evidence dist/rooms-init-im-full
```

It uses isolated settings, Manager data and local model fixtures. The new
scenario checks zero-call setup, five native private responses and exact runs,
non-destructive examples, avatar cropping/persistence, IM geometry, themes,
viewport bounds and restored state.

Acceptance on 2026-09-14 passed against local develop including its accepted
submission and empty post-submission response fixes. The final selected suites
passed 418 Runtime/Manager tests and 118 renderer tests. Fresh initialization,
existing-profile upgrade and the combined task/peer/Agent/content/UI Electron
scenarios passed without uncaught page errors.

The upgrade preview reloads current identities when opened and offers an explicit
refresh after a version conflict. Nested popovers close before their native modal
on Escape, including when saving temporarily disables the focused control.
Sidebar status refreshes are throttled and coalesced so a stream cannot starve
activity updates or start overlapping refresh chains. Recency and pagination use
immutable Manager document sequences, matching the persisted message timeline;
profile edits and opening an existing Agent's private chat do not move its row.
