# Rooms personal-assistant reliability and chat follow-through

This change extends the existing Kun Runtime, RoomStore, ArtifactStore and
Workbench bridge. It does not add a second executor or a second canonical
business-data writer. Repository tasks still use their existing ownership,
review, verification and integration controls.

## Runtime acceptance matrix

| # | Review item | Implemented acceptance |
| --- | --- | --- |
| 1 | Busy conversation steering | A normal private user message reaches the direct runner while its lane is busy. It may merge into the exact eligible live turn, but cannot claim another turn or bypass model/workspace/epoch checks. A real Runtime + dispatcher + blocked-model regression covers this path. |
| 2 | Safe default permissions | New and unset private-room policies use Ask for approval. A CAS migration records that default for legacy rooms; explicit choices and already accepted request/run snapshots are retained. Retries and reminder wakes freeze current authority. |
| 3 | Cross-conversation commitments | Agent-scoped durable commitments have a user-message source, owner identity, objective, deadline, next check, blocked/waiting explanation, execution links, acceptance evidence and results. API and tools support creation, search, paging, updates and cancellation without requiring Git. |
| 4 | Durable result inbox | Background shell/subagent/Workbench outcomes retain root-request identity after newer user topics. Result and queued continuation commit together; duplicate keys cannot change payload. Admission rechecks source cancellation, membership, workspace, epoch and permissions. Result status is queryable and repaired from the authoritative request after a lost status receipt. |
| 5 | Optional persistent host | Explicit `kun host start/status/stop` manages an independent detached foreground owner. Status probes and process/instance fencing prevent falsely reporting online or stopping another owner. Startup failure, restart observation, concurrent starts and stop/exit are tested. |
| 6 | Recurring and conditional reminders | Existing one-offs remain valid. Interval/daily/weekly recurrence uses explicit IANA timezones; DST, quiet hours, dedup keys, pause/resume, expiry and occurrence limits are covered. Room-idle/new-message conditions are evaluated from current state before dispatch. A per-Agent CAS ledger checks rolling budgets on create/update/fire. |
| 7 | Reliable notification delivery | Final private messages, attachment-only results and user approval/input intents join the existing global Rooms event queue. Pending live gates repair a failed observer projection. Renderer replay/retry and native delivery receipts dedupe across reload/reconnect; automatic-review gates and muted/suppressed notices are filtered. |
| 8 | Durable artifact library | Private delivered files are captured into the shared ArtifactStore with immutable identity/version/hash/source metadata. Agent-scoped search, paging, version selection, reversible archive and checksum-verified export are available. Separate bounded legacy paging reaches old nested references and root files beyond the former 200-message/100-file window. |
| 9 | Bounded scheduling | Task projection hydrates/replays in 128-row slices, fails closed on incomplete capacity knowledge, invalidates on relevant events, and backs off indefinite waits. Due-time ordering prevents starvation. Per-task mutation lanes keep the entire scan from blocking foreground messages; bridge/peer admission retains its existing action fence. The global ceiling is configurable under `runtime.rooms.maxConcurrentTasks` (1–32, default 2). |
| 10 | Outcome-based goal progress | Repeated reads, mere successful shell exit, bookkeeping and no-op writes do not reset progress. Unique verified changes/results are evidence. Private goals enforce no-progress, token and active-time budgets, excluding user approval/input waits. Suppressed oversized tool batches and resume limits are tested. |

## Chat acceptance matrix

These are implementation and automated interaction-test claims. Visual and
real-device acceptance remain separate and are listed below.

| # | UI item | Implemented acceptance |
| --- | --- | --- |
| 1 | Truthful unread state | A dot indicates unread messages; global storage sequence differences are never displayed as a message count. Attention remains a separate state. |
| 2 | Reading position | First-unread boundary/jump, an actual loaded-message count while away from the end, and message-id/offset anchors preserve context. |
| 3 | Search context | An independent result panel keeps its scroll position while a selected match loads neighboring messages and highlights its timeline target. Closing search restores the prior reading position. |
| 4 | Quote versus discussion | Quote targets are explicit. Discussion replies use a drawer-owned composer and keep the discussion open after sending. |
| 5 | Attachment lifecycle | Typing continues during upload. Each file has upload/failure/cancel/retry state; late results are fenced after cancellation/unmount. Attachment-only optimistic messages retain file cards. |
| 6 | Header hierarchy | Identity/status/search/details remain primary; low-frequency settings live in More. Idle discussion strips collapse. |
| 7 | Sidebar state | Draft preview and mute state are visible; deleted conversations move into management; unread and actionable state are distinct. |
| 8 | Responsive layout | Container-width rules preserve the central chat, use a detail overlay when space is insufficient, and truncate long identity labels. |
| 9 | Timeline density | Compact HH:mm timestamps, day separators, grouped timestamp reveal and expandable long replies reduce visual noise. |
| 10 | Message actions | Actions no longer overlap message content; common actions plus More/context menu remain reachable. Pin feedback follows confirmed success. |
| 11 | Composer clarity | Mention chips are deduplicated, attachment previews have explicit removal, and send/newline shortcuts are visible. |
| 12 | Images | Fit/original-size/zoom/pan, same-message previous/next navigation and compact image grids are available. |
| 13 | Recovery states | Sidebar skeletons, specific empty/filter states, upload errors and retry controls replace generic dead ends on affected paths. |
| 14 | Mobile and keyboard | In-room search, focus restoration, keyboard lightbox controls, viewport/soft-keyboard sizing and larger touch targets are implemented. |

## Deliberate boundaries

- A commitment is a responsibility ledger, not another executor. `nextCheckAt`
  is next-action metadata; use reminders or an existing job to schedule work.
  Cancelling a commitment does not silently cancel linked tasks or threads.
- Host mode is explicit, does not install OS autostart, and does not permit a
  normal GUI to attach to or steal its canonical profile. Existing non-owning
  TUI `--url` / `--no-start` flows can connect. See
  [persistent host operation](./rooms-persistent-host.md).
- Notifications require the supported connected GUI/native channel. This is
  not remote push while the computer is offline and is not proof the user read
  a banner. OS display followed by a crash before receipt persistence permits
  an at-least-once duplicate; explicit native failure is retried.
- Reminder conditions currently cover room-idle and room-message events.
  They are foundations for conditions, not a claim of external webhook support.
  Late recurrence skips missed occurrences rather than replaying a flood.
- Saved artifact versions represent bytes captured at delivery. Legacy
  workspace references remain live files; overwritten pre-migration bytes
  cannot be reconstructed. Work/document and repository references retain
  their existing semantics. Archive is reversible and does not purge blobs.
- Cancelling an upload fences its result from the draft. A transport without
  abort support may still finish storing unused bytes; cancellation does not
  promise server-side erasure.

## Validation and remaining manual acceptance

Automated coverage includes real Runtime steering, admission/cancellation
barriers, SQLite restart persistence, authority revocation, duplicate results,
reminder DST/late/cap/pause cases, 1,000+ reminder/file-history boundaries,
artifact immutability and checksum checks, native notification show/failure
receipts, detached host processes, and React interaction regressions.

Run the project gates with a writable isolated test HOME and enough Node heap:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

In resource-limited environments the runtime and renderer test suites can be
run separately with `--maxWorkers=2`. Set `TZ=UTC` for timezone-dependent legacy
tests. Native tests also need the matching SQLite/PTY bindings and Electron;
some existing quota tests require the `sqlite3` executable.

Before removing draft status, manually verify desktop 1280/960-width layouts,
125% zoom, long names, mobile keyboard overlap and image panning. Exercise
scroll-away/new messages, search/return, open-discussion reply, slow upload
cancel/retry, and native approval/result notices while outside Rooms, after
renderer reload, and after reconnect. This environment's cloud browser denied
its localhost preview (`ERR_BLOCKED_BY_CLIENT`), so no browser screenshot,
visual pass, macOS/Windows packaged smoke or real-mobile pass is claimed here.
