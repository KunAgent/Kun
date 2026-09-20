# Rooms conversation experience

Rooms provides message reply threads, read-only content previews, reactions and
polls, room filters and notification settings, member portraits, resizable
panels, and grouped run inspection. These features use the existing desktop
bridge, Kun Runtime and Manager-owned stores.

## Reply threads

A reply action opens the root message, its nested replies and an independent
composer in the existing details drawer. Replies remain in the main feed.
`displayThreadRootId` is a presentation identity derived by the host from the
explicit reply chain; it does not replace `rootRequestId`, create a new model
session or establish a separate discussion budget. An agent reply inherits only
one provable triggering branch; ambiguous merged updates stay in the main feed.

The host resolves historical chains with a depth limit and reports missing,
inconsistent or cyclic references. SQLite counts identifiers and selects page
identifiers before loading message bodies. Merely opening a thread does not
rewrite history, wake an agent or reset a budget.

The drawer keeps a navigation stack for replies, member details, task details,
content and exact runs. Returning restores the original page, draft, reading
position and focus. Only the active run or reply page subscribes to live detail
updates. Main and reply composers use separate persisted draft identities.

## Content and portraits

Messages can carry validated references to attachments, repository files, room
tasks, immutable deliveries and existing project-board cards. Repository refs
are checked against the original request's repository identity as well as the
current room. File reads validate canonical paths and file identity. Deleted,
moved and out-of-scope sources never resolve to a similarly named object.
An attachment with a proven public-message origin can retain its exact
server-derived room discussion scope after the original native thread is cleaned
up; unrelated room or data-directory scopes are rejected.

Previews expose content only. Editing and approvals remain in Work, Code,
project boards and task controls. Fixed delivery previews keep the exact version;
project-card navigation uses an exact card lookup rather than a limited scan of
the first pages. Read-only project-board access does not repair corrupt files.
Sharing a reference-only card in Auto mode creates a discussion request; it is
not an implementation goal.

Image cards lazy-load the upload-time display projection and reserve dimensions
before displaying it. Original image bytes are fetched only when the user opens
the lightbox. Bounded WebP upload projections are supported alongside normalized
PNG/JPEG thumbnails. Legacy images without a display projection retain a file
card with an explicit original-image entry.

Only the first ordinary URL in a visible public message loads an automatic
preview. Raw run transcripts and generated prompts do not fetch linked pages.
The display setting can disable automatic previews. Metadata and preview images
are fetched without credentials, cookies or script execution; all destination
addresses and redirects must pass public-network validation with pinned DNS.
The preview-only HTTP policy does not change extension network defaults.

Members may select one of the existing 30 portraits or upload PNG/JPEG images
up to 2 MiB. Uploaded portraits are normalized to inert 128 x 128 JPEG pixels
and have a Manager-owned provenance receipt. Member updates and image reads
validate that receipt. Temporary lease cleanup respects managed portraits and
attachments referenced by room messages. No AI portrait generation is added.

## Input, reactions and polls

The composer uses the existing Tiptap dependency with text, line breaks and
atomic member tags. It persists plain text plus structured member identities,
not HTML. Pasted text does not acquire mention authority. `@all` expands into
the enabled members at send time and remains subject to the normal 32/8 limits.
Enter inserts a newline; Cmd/Ctrl+Enter sends, with IME handling preserved.

Local reactions are idempotent. Polls have 2-10 options, single or multiple
selection, replacement of a voter's own ballot, manual close and optional
expiry. Poll creation, reactions, ballots and expiry are presentation events:
they do not create discussion requests, wake members or change the discussion
publication version.

The user can explicitly invite selected members to vote. That action creates a
normal discussion-only request and freezes the poll and recipient identities.
`vote_room_poll` binds its voter to the exact native run and original invitation,
honors tool restrictions, and rejects stale, cancelled, closed or unauthorized
operations. Ballots are never task approvals or execution authorization. A
separate explicit action sends the current poll results into discussion.

## Organization and run inspection

Room filters include All, Unread, Needs attention, Archived and bound repository.
Unified search groups exact room, member, message and task targets. Filtering is
performed before pagination; live refresh revalidates affected loaded rows and
retains the loaded tail and cursor. Read cursors and their update events commit
together so an active unread filter updates without another conversation event.

Room notifications can be muted for one hour, 24 hours or until manually enabled.
Mute affects desktop notifications, not tasks, discussion or attention markers.
Delivery checks the current preference and its silence watermark; unmuting does
not replay deferred events from the muted interval. Preferences are separate
from the room's frozen authorization state.

The list width defaults to 320 px (240-520); details default to 400 px (360-640).
Effective widths also leave space for the conversation at smaller desktop sizes,
and narrow windows use overlays. Grips support pointer and keyboard adjustment.
Widths, left-aligned versus user-right message layout, and automatic link
preview settings are saved per device.

Run history has phase, status and keyword filters. Within one run, tool calls and
results are paired by exact `callId`; missing counterparts can be fetched through
bounded `turnId + callId` pages. Missing results never imply successful execution.
Raw fields stay collapsed and long values load in fragments. The room overview
aggregates persisted run facts, distinguishes complete, partial and unknown
usage, and exposes topic budgets without a global diagnostics panel.

## Contracts and validation

RoomStore adds reply paging, search, repository choices and run aggregation.
Presentation records use `room_poll`, `room_reactions`, `room_preference` and
`room_avatar`. Runtime-owned poll/reaction/portrait writes retain the existing
Manager fence. Capability negotiation requires `room-store-v5` and
`item-call-page-v1`; existing stores and messages remain readable.

The HTTP additions are registered under `/v1/rooms`: reply pages, scoped content,
link previews, interactions, polls, room preferences, repository choices, unified
search and run summaries. Main-process method allowlists match each read/write
contract. Card navigation additionally uses the read-only exact project-card API.

Validation covers scoped persistence and replay, no-wake presentation events,
native queued voting, historical reply chains, bounded tool pairing, previews and
SSRF controls, portrait provenance and lease retention, pagination races, mute
delivery, IME and navigation behavior. Offline Electron commands:

```sh
npm run typecheck
npm run build
node scripts/smoke-development-rooms.cjs --experience-only --evidence dist/rooms-experience-smoke
node scripts/smoke-development-rooms.cjs --ui-visual --evidence dist/rooms-experience-full-smoke
npm run check:file-lines
```

The isolated fixture uses a real Manager and Kun queue with a local model stub.
It checks model-call and topic-budget counters around presentation operations.
Do not modify renderer sources or rebuild Runtime output during a running smoke.

Acceptance on 2026-09-13, including the latest local develop changes:

- Full typecheck, build (including Kun), scoped ESLint and the file-line gate passed.
- Related Runtime suites passed 459 tests in 63 files; renderer and bridge suites
  passed 180 tests in 24 files.
- Both the experience-only and full task/peer/UI Electron scenarios passed.
  The full run saved 70 captures with no page errors, including native light/dark
  windows, scaled UI and a separate narrow renderer viewport.
- Presentation operations preserved model-call and discussion-budget counters;
  task execution, approval, review, immutable delivery, recovery and application
  remained operational. Evidence is generated under the chosen `--evidence` path
  and is not committed.

Agent private chats, cross-room persistent memory, idle patrols, multi-user
workspaces, a new calendar and in-drawer document editing are outside this change.
