## Why

Kun can preview hardened HTML artifacts, but a Code conversation has no small, general-purpose way to publish one interactive UI component directly into the answer flow. Delegating generation to a design child agent can help when the component still needs design work, but it should not be mandatory when the main agent already has valid HTML. Users currently have to leave the conversation for a separate canvas or browser even when they only want to show, compare, or refine one component interaction.

## What Changes

- Add a first-party `component-designer` child-agent profile specialized in accessible, responsive, component-scoped HTML interaction prototypes.
- Add a top-level `design_component` tool whose primary contract is publishing hardened component HTML inline. It accepts complete HTML directly without starting a child agent; when only a design request is supplied, it can optionally invoke the dedicated child agent.
- Keep the direct publishing path available when subagents are disabled or unavailable.
- Persist each standalone prototype under `.kun-design/component-prototypes/` and return durable structured metadata through the normal tool-result/SSE history path.
- Harden generated prototypes with workspace containment, size and structure validation, and an offline Content Security Policy.
- Render running and completed component prototypes as interactive cards in the middle of the existing conversation timeline rather than opening a separate canvas.
- Add desktop/mobile preview controls plus adopt, iterate, inspect-code, copy-code, and refresh actions that remain inside the conversation workflow.

## Capabilities

### New Capabilities

- `component-prototype-tool`: A bounded Kun tool that publishes a durable HTML prototype artifact directly and can optionally package component-design context for a dedicated child agent.
- `inline-component-prototype-message`: A safe, interactive conversation message card for component-level HTML prototypes and follow-up actions.

### Modified Capabilities

None.

## Impact

- Kun built-in subagent profiles, the direct/optional-delegation tool provider, runtime composition, and tool-result tests.
- Renderer Kun mapping, turn-section derivation, message timeline rendering, and a new inline prototype card.
- Existing main/preload prototype authorization and isolated webview paths are reused; no second runtime, provider, or standalone canvas is added.
- Prototype files are workspace-local design artifacts and remain portable with existing `.kun-design` handling.
