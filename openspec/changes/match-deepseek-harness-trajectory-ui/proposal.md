## Why

Kun's current trajectory view exposes the required data but uses a card-oriented dashboard that differs materially from the dense ledger, timing overview, inspection workflow, and composer integration in DeepSeek Harness. The view should match the frozen Harness implementation so request/tool chronology can be scanned and manipulated with the same information density and interaction semantics.

## What Changes

- Replace the current trajectory toolbar, summary strip, filters, timeline, Turn cards, rows, and generic inspector with a port of DeepSeek Harness `ui-trajectory` at commit `0a53fb55bea101816fa226bb964ae2bed71c343b`.
- Retain Kun's title-bar Trace toggle and runtime status indicators while matching Harness geometry, table structure, fold/search behavior, timeline gestures, detail tabs, responsive inspector, and floating-composer clearance.
- Add System, Context, Compacted, Assistant, Tool, and Subtool renderer projections plus request-boundary records and prompt revision metadata.
- Upgrade the trajectory HTTP DTO to schema v2, keep v1 readable, and scope request details to the owning request/step.
- Add rich Markdown, JSON/Schema, image, source, timing, usage, options, and Prompt Diff presenters.
- Port the Harness behavior test matrix and add deterministic Electron screenshot validation for the frozen layout.

## Capabilities

### New Capabilities

- `harness-trajectory-ui-parity`: Pixel- and behavior-level parity with the frozen DeepSeek Harness trajectory package while preserving Kun shell, themes, storage, and capture policy.

### Modified Capabilities

None.

## Impact

- Replaces the renderer trajectory component hierarchy and adds CSS modules and pure layout/timeline/virtualization helpers.
- Extends Kun trajectory contracts, query projection, detail resolution, IPC parsing, localization, and tests without changing storage files or route paths.
- Reuses existing `@tanstack/react-virtual`, `diff`, Markdown, attachment, and Electron Playwright capabilities; no runtime dependency on the Harness repository is added.
