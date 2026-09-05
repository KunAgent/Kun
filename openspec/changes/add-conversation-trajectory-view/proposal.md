## Why

Kun already captures model-request diagnostics, but the information is confined to a right-side inspector and persists large request/response payloads independently from the canonical conversation history. Users need a conversation-level trajectory view that makes model, tool, timing, usage, retry, and failure behavior understandable without multiplying long-session storage.

## What Changes

- Add a title-bar trajectory toggle that switches the conversation center between chat and a full trajectory workspace while preserving the composer and chat state.
- Add a chronological, paginated, virtualized trajectory ledger with Turn/Step grouping, a three-lane timeline, filters, search, summary metrics, live follow, and responsive record inspection.
- Replace the workbench Agent Perspective right-panel entry with the center trajectory view while preserving the explicit per-conversation content-capture policy.
- Persist compact request lifecycle metadata for every model attempt, correlate it with canonical Session items and tool call IDs, and recover unfinished attempts as interrupted.
- Store optional exact prompt material as content-addressed, compressed blobs referenced by prompt manifests; do not durably duplicate response messages, tool results, attachments, raw HTTP frames, or stream deltas.
- Add bounded retention, legacy trace compatibility, authenticated trajectory paging/summary/detail APIs, and renderer/runtime contract coverage.

## Capabilities

### New Capabilities

- `conversation-trajectory-view`: Conversation-level trajectory navigation, timeline, ledger, inspection, live behavior, responsive layout, and UI-state isolation.
- `compact-trajectory-storage`: Always-on request metadata, prompt manifests, content-addressed detail blobs, retention/recovery, legacy compatibility, and trajectory query APIs.

### Modified Capabilities

None.

## Impact

- Affects Kun model-request observation, trace persistence, thread deletion/recovery, HTTP routes, and shared contracts.
- Affects the renderer runtime client, conversation shell/top bar, right-panel contribution registry, localization, and Agent Perspective components.
- Adds a renderer virtualization dependency and a rebuildable trajectory query index while retaining filesystem fallback behavior.
- Changes new durable model-request diagnostics from raw request/response duplication to compact metadata plus optional manifests; legacy records remain readable.
