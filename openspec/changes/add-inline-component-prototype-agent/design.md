## Context

The only live agent runtime is `kun serve`. It already owns bounded child-agent execution through `DelegationRuntime`, persists child runs as side threads, and exposes tool results through the same HTTP/SSE history used by the GUI. The renderer already has a hardened `DesignHtmlPreviewHost` that authorizes a workspace-contained `.kun-design` HTML file through main/preload and mounts it in a sandboxed Electron webview.

The missing capability is the product contract joining those pieces. A generic tool result is folded into the work-process disclosure and does not give the renderer a durable, typed component prototype path or a reason to surface an interactive result in the answer body. Generation is a separate concern: the main agent may already have complete HTML, while a design child agent is only one optional way to produce it.

## Goals / Non-Goals

**Goals:**

- Give the main agent one purpose-built tool for publishing, designing, or revising a single UI component interaction.
- Publish complete HTML directly without starting a child agent, including when subagents are disabled.
- Retain a dedicated child-agent profile as an optional generation path when the caller supplies a request instead of HTML.
- Accept both direct existing implementation text and bounded workspace source files as child context.
- Stream a visible preparing/running card, persist the final artifact metadata, and replay it after reopening the thread.
- Render the component inline in the current conversation and keep adoption/iteration in the composer workflow.
- Enforce offline, workspace-contained, component-scoped HTML with a strict size and structure contract.

**Non-Goals:**

- Generating or previewing a whole website or multi-page user journey.
- Replacing the full Design workspace/canvas for boards, screens, flows, or handoff.
- Running a second agent process, provider, RPC bridge, or renderer-owned model loop.
- Automatically applying the prototype to production source without a follow-up user/agent turn.
- Allowing remote scripts, fonts, frames, network requests, Node integration, or arbitrary file navigation.

## Decisions

### 1. Make artifact publication the top-level tool contract

`design_component` is registered in the main tool catalog independently of `DelegationRuntime`. When the caller provides complete `html`, the tool validates, hardens, persists, and returns it immediately; no child run is created. When `html` is absent and a `request` is present, the tool may call `DelegationRuntime.runChild` with the built-in `component-designer` profile. If delegation is unavailable, the direct path remains advertised and the request-only path returns a structured error asking the caller to provide HTML.

The child registry does not include the wrapper, preventing recursive component-design delegation. The optional child profile inherits the parent's model/provider and approval policy but has an exact file-oriented tool allow-list with no shell or nested delegation. Its filesystem sandbox is deliberately narrowed to `workspace-write` rooted at the reserved artifact directory, so `write`/`edit` cannot touch product source even when the parent has full access.

The wrapper owns output-path reservation, direct HTML publication, bounded context packaging for optional delegation, progress events, artifact verification, and the structured result the GUI needs.

### 2. Use a versioned durable tool-result contract

The tool emits a `componentPrototype` payload with version, status, title, relative path, viewport, producer, optional child id/profile, byte size, content hash, and summary. `producer` distinguishes `main-agent` direct publication from `component-designer` delegation. New renderers infer `component-designer` for old payloads that predate the producer field. Preparing/running partial results use the same shape. Final tool history therefore rehydrates without a new HTTP endpoint or renderer-local registry.

The renderer copies the validated payload into `ToolBlock.meta.componentPrototype` and derives `componentPrototypeBlocks` separately from generic process blocks. The original tool block remains visible in the collapsible work trace, while one inline card is rendered in the answer flow.

### 3. Reserve one workspace-local standalone file per invocation

Artifacts live at `.kun-design/component-prototypes/<slug>-<id>/prototype.html`. The wrapper creates a lightweight generating document before either publishing direct HTML or starting the optional child so the inline card can appear immediately. Existing code can be supplied directly or read from up to a bounded number of workspace-contained source files for the delegated path.

Both caller-supplied and child-produced HTML must be a complete single-file document containing `meta[name="kun-component-prototype"]` and one `data-kun-component-root` root. The document body may center the component for demonstration, but may not add full-page navigation or application chrome.

### 4. Validate and harden before declaring completion

The wrapper rejects oversized, fenced, incomplete, framed, embedded, or remotely dependent HTML. It removes any model-supplied CSP and injects an offline policy allowing only inline CSS/JS and data/blob media while denying connections, frames, objects, base URLs, forms, and remote resources. Workspace resolution is symlink-safe and enforced even under full-access mode for this artifact path.

Main process authorization remains the second containment boundary. The webview keeps `nodeIntegration=no`, `contextIsolation=yes`, `sandbox=yes`, `webSecurity=yes`, and a non-persistent per-card partition.

### 5. Keep the card in normal message layout

The card is rendered after the work disclosure and before/alongside the final answer content in the current single-column timeline. It has a bounded height and responsive width; desktop/mobile changes only the guest viewport. No right panel, modal, route change, or automatic browser opening occurs.

Adopt and iterate actions prefill the existing composer with an explicit prompt referencing the prototype path. Inspect-code opens the normal workspace file preview. Copy and refresh operate locally on the artifact.

## Risks / Trade-offs

- **The caller or child supplies malformed or page-level HTML.** The marker contract and optional child prompt steer scope; structural/offline validation fails closed and returns an actionable tool error.
- **Large source context hurts model latency/cache.** Direct code and source-file excerpts are independently bounded with a total context ceiling; dynamic context stays in the child prompt, outside the stable system prefix.
- **A running card points at a file that does not exist yet.** The wrapper reserves a generating document before emitting progress for either path, and the existing preview host retries/watches revisions.
- **Several cards share Electron state.** Each card uses a stable non-persistent partition derived from its tool-block id.
- **An old renderer sees the new tool.** It falls back to a normal tool row and final assistant text; the durable result remains valid.

## Migration Plan

No persisted-data migration is required. Existing turns contain no component prototype payload. New prototype artifacts use the already portable `.kun-design` directory. Rollback removes tool advertisement and the inline renderer; existing files and tool history degrade to ordinary tool results.

## Open Questions

None for the first release. Automatic source-code application remains an explicit follow-up turn so the user can approve the interaction direction before implementation.
