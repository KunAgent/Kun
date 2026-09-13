# Rooms conversation interface

The Rooms interface borrows Cumora's conversation hierarchy while using Kun's
existing light and dark theme tokens. It does not change peer discussion,
execution intent, approval, task recovery, or delivery protocols.

## Conversation layout

- A 320px conversation list shows local member avatars, a current message
  preview, its timestamp, unread markers, and real activity counts.
- The header contains the room name, members, collaboration mode, message
  search, details, and a menu for room settings, pinning, and archival.
- The 400px details panel opens on demand. Below 1280px it becomes an overlay;
  below 768px the conversation list also opens as an overlay.
- Message authors remain left aligned. Static 38px avatars and historical
  author names identify participants. Text bubbles are at most 580px wide;
  code, tables, and attachments can use the available conversation width.
- Thirty generated Kun portraits share one local sprite atlas. Default members
  use matching role portraits; other members use a stable ID-based selection.
  Names and transient activity do not change the selected portrait. The local
  catalog is `src/asset/img/room-avatars/gallery.html`.
- Reply, copy, and pin actions appear on hover or keyboard focus. Linked tasks
  remain visible. Scrolling up stops automatic following; Back to latest
  restores it. Loading earlier messages preserves the reading anchor.

## Composer and details

The composer grows from 40px to 200px before scrolling internally. Its toolbar
contains attachments, member mentions, Add context, topic selection, execution
intent, and Send. Task and repository selectors live in Add context; selected
values appear as removable chips. Replies, files, and mentioned members share
the area above the text input.

Enter inserts a newline; Cmd/Ctrl+Enter sends. Mention navigation takes keyboard
priority, and composing text with an input method never accidentally sends.
Failed sends retain their draft and request identity. The existing local-file
attachment contract remains in use.

Topic cards show their title, status, and stop/continue actions first. Member
details and response counters are collapsed under Members and response budgets.
Errors and waiting-for-user actions stay visible, with tasks and approvals
available through the existing details sections.

## List projection

`RoomListEntry.latestMessage` is an optional query projection. It contains the
message ID, author kind/member/name snapshot, a plain-text preview, creation
time, and attachment count. Previews contain at most 160 Unicode characters.
SQLite pages rooms before joining their latest message and reads at most a
bounded body prefix; the renderer does not fetch every room's message history.

The projection does not add fields to persisted Room documents or change list
ordering. Message creation and revision refresh the preview. Empty rooms and
older responses fall back to the room description or member names. Message
sequence differences are never interpreted as unread message counts.

## Verification

Run the scoped renderer and projection tests, TypeScript checks, the application
build, and the authored-file line limit. Then use the offline Electron fixture:

```sh
node scripts/smoke-development-rooms.cjs --ui-only --evidence dist/rooms-ui-smoke
node scripts/smoke-development-rooms.cjs --ui-visual --evidence dist/rooms-ui-full-smoke
```

The fixture uses isolated settings, a temporary Manager profile, synthetic
messages, and a local model stub. It checks menus, focus restoration, mentions,
attachments, search, reading position, input growth, and horizontal overflow.
Screenshots cover light/dark themes at desktop sizes and a separately labelled
narrow renderer emulation. Real desktop window dimensions are recorded because
the application's minimum window size can prevent a requested smaller size.

Do not rebuild or modify renderer files during a running Electron smoke: build
cleanup and hot module replacement would invalidate its evidence.

### Recorded validation (2026-09-13)

The full offline `--ui-visual` run passed with no renderer page errors. It
retained the existing task, approval, structured-input, recovery, review,
delivery and Git integration checks, plus exact peer message publication and
stop/continue/topic isolation checks. The evidence contains 47 screenshots.

Light and dark themes passed at native 1360x900 and 960x780 window sizes, with
the actual 1360px window content height recorded as 872px. Separate checks
covered 82% and 125% UI scale and CDP-emulated 720x780 renderer dimensions.
Timeline, composer and workspace widths stayed within their containers. The
conversation list measured 320px and the empty input measured 40px at 100%.

The run also exercised keyboard menu focus and Escape, search, real attachment
preview, mentions, task/repository chips, replies, reading-position preservation
and Back to latest. Local evidence is in
`dist/rooms-cumora-full-smoke/report.json`; generated evidence is not committed.
