# Conversation Trajectory

Kun exposes a conversation-scoped trajectory view for model requests, Session messages, tool calls, timing, usage, retries, and failures. It is a content view of the selected conversation, not a runtime diagnostics or provider-control panel.

## UI

Use the **Trace** button in the conversation title bar to switch the center area between chat and trajectory. The composer and hidden chat timeline stay mounted, so drafts, model/permission choices, and chat scroll state are preserved.

The trajectory contains:

- a 32px Duration/Turns/Calls toolbar with loaded-window incremental search;
- a 50px input/model/tool timing overview with sequence and recorded-duration modes;
- a chronological two-column Event/Content ledger with Turn rails, request boundaries, backward pagination, independent Turn/call folding, and virtualization above 100 rows;
- synchronized timeline range selection, wheel zoom, right-button pan/clear, delayed tooltips, and ledger selection;
- record-specific System, Request, Markdown, Tool, and Subtool inspectors with Markdown, JSON/Schema, attachment, source, options, usage, timing, and Prompt Diff views;
- live-edge following that pauses while older records are being inspected.

At wide widths the inspector docks at `clamp(320px, 38%, 440px)` and can be resized to 720px while retaining at least 280px for the ledger. At 760px and below it becomes a right overlay no wider than 420px. The Event column collapses from 122px to an icon-only 50px when its table container reaches 620px. The old Agent Perspective right-panel contribution remains removed; saved references to that panel normalize to no panel.

Trajectory opens with no selected record, leaving the ledger at full width. Selecting a ledger row, request boundary, or timing span opens the typed inspector; its Summary view presents status, hierarchy, usage, timing, and bounded previews rather than dumping the normalized wire record as JSON.

The entire trajectory surface explicitly opts out of Electron's draggable window region. This is required because the surrounding Workbench shell is draggable; without the `no-drag` boundary Chromium consumes ledger clicks and wheel gestures as title-bar interaction.

The existing Composer remains mounted in trajectory mode so its draft/model state survives, but it is visually hidden, inert, and removed from pointer hit-testing. The ledger and inspector therefore use the full interaction surface with only 16px bottom clearance; returning to Chat restores the same Composer instance.

## Capture policy

Lifecycle metadata is always recorded. The existing per-thread `modelRequestCaptureEnabled` switch controls only complete prompt detail and bounded in-memory wire diagnostics. Settings continues to control the default for conversations created later.

When complete content capture is off, model/tool status, usage, timings, retries, errors, and canonical Session output remain available. Exact System Prompt, tool schemas, and request options display as not captured.

## Storage

Canonical conversation content remains in the Session store:

- user and assistant messages;
- reasoning items;
- tool arguments/results;
- compaction items;
- attachments and generated media.

Trajectory persistence stores compact lifecycle facts and references. It never durably stores ordinary stream deltas, raw HTTP headers/frames, credentials, attachment bytes, image/Base64 bodies, complete tool outputs, or another copy of assistant output.

Optional prompt detail uses a manifest and immutable content-addressed blobs:

```text
<dataDir>/observability/trajectory/
  records/<base64url-thread-id>.jsonl
  manifests/<base64url-thread-id>/<base64url-request-id>.json
  blobs/<sha256>.br
```

Blobs are sanitized before hashing, compressed with Brotli, deduplicated by SHA-256, and written with private directory/file permissions. Large blobs retain bounded head/tail data with explicit truncation metadata.

Default detail budgets are:

- 512 MiB globally;
- 64 MiB per conversation;
- 16 KiB inline detail preview;
- 2 KiB searchable list preview;
- 8 MiB maximum source blob before bounded head/tail retention.

Budget cleanup evicts old detail only. Lifecycle metadata remains until the conversation is deleted. Conversation deletion removes its manifests and legacy trace file, then mark-and-sweep removes unreferenced blobs.

Legacy schema-v1 model-request JSONL remains readable without an eager destructive migration. New durable records omit raw request and response bodies. The query layer projects both formats into trajectory wire schema v2; the renderer also normalizes an older schema-v1 HTTP page when talking to an earlier runtime.

## API

Authenticated routes:

```http
GET /v1/threads/{threadId}/trajectory
GET /v1/threads/{threadId}/trajectory/summary
GET /v1/threads/{threadId}/trajectory/{recordId}/detail?section=overview
```

The page route accepts `limit` and an opaque `cursor`. Existing `filter=all|llm|tool|error` and bounded `q` parameters remain compatible, while the current UI searches the already-loaded page locally. Detail sections include `overview`, `input`, `output`, `usage`, `timing`, `raw`, `arguments`, `result`, `system-prompt`, `tools`, `diff`, `options`, `rendered`, `source`, and `schema` as appropriate for the selected record.

`GET /v1/threads/{threadId}/model-requests` remains available for compatibility. The thread PATCH field remains the content-capture switch.

## Failure and recovery behavior

- Every concrete Provider attempt has its own request ID and attempt ordinal.
- Attempts from one logical model step share a round ID and Step number.
- First model content records the TTFT boundary; stream deltas are not persisted as trace rows.
- A pending persisted attempt with no matching live request is projected as interrupted after restart.
- Missing or budget-evicted manifests do not hide lifecycle metadata.
- Query and capture failures never retry, rewrite, or block the Provider request.

## UI reference and attribution

The trajectory layout, timing interactions, dense ledger information architecture, inspector behavior, and reference-derived test matrix are adapted from DeepSeek Harness `packages/client/ui-trajectory`, frozen at commit `0a53fb55bea101816fa226bb964ae2bed71c343b`. That source is MIT licensed, Copyright (c) 2026 DeepSeek; the notice is retained in `THIRD_PARTY_NOTICES.md`.

Role colors follow the same semantic model across the timeline and ledger: System/Compacted neutral, User blue, Context green, Assistant violet with a lighter TTFT segment, Tool/Subtool amber, and failures red. These map to Kun theme tokens rather than fixed light-theme colors. Timeline range selection uses a tinted interior, solid accent edges, and outside masking; opening the view clears a stale range from an earlier visit.

Kun does not import or runtime-link the Harness checkout. The port uses Kun's trajectory schema, Session records, Markdown/attachment renderers, persistence rules, accessibility conventions, and semantic theme tokens. Harness global navigation, page tabs, Cordis slots, and unrelated application shell are not included.
