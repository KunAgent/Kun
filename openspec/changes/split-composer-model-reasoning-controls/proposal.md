## Why

Kun's Code composer currently combines model selection and reasoning effort in one control, even though they are separate decisions with different change frequency and meaning. Splitting them makes each choice immediately legible and gives reasoning a focused, visual interaction without forcing users through the model menu for a routine adjustment.

## What Changes

- Change the Code composer only: replace the combined model-and-reasoning trigger with two adjacent, borderless text controls for the provider/model and reasoning effort.
- Keep provider grouping, model search, capability badges, setup guidance, and vision-switch safeguards in the model menu only.
- Add a dedicated, borderless reasoning popover with `更快` / `更智能` endpoints, a vivid blue-to-magenta energy rail, white thumb, animated bubbles, layered sweep light, and visible stop nodes.
- Map all currently supported reasoning efforts to evenly distributed discrete stops; map `auto` to the far-right stop and show effort names only in the composer trigger.
- Keep the model and reasoning controls operable during an active turn; changes configure the next submitted turn and do not alter the request already in flight.
- Keep `off`, `low`, and `medium` visually calm with a static blue fill; enable the seamless color loop, sweep light, and bubbles only for `high`, `max`, and `auto`, with reduced-motion and dark-theme behavior.
- Preserve existing session-level reasoning state, normalization, and runtime request semantics; this is a composer interaction change, not a new provider protocol.

## Capabilities

### New Capabilities

- `composer-model-reasoning-controls`: Defines Code-only separate model and reasoning controls, including visible discrete effort nodes, responsive layouts, motion, accessibility, and session-state expectations.

### Modified Capabilities

None.

## Impact

- Renderer: `FloatingComposer`, `FloatingComposerModelPicker`, Code composer props, related placement/state helpers, and base-shell styling.
- State/contracts: existing `composerReasoningEffort` callbacks and model reasoning profiles are reused; no preload, main-process, Kun HTTP, SSE, or persistence schema change is expected.
- Tests: component rendering, menu placement, rail mapping, supported-effort normalization, model switching, reduced motion, and keyboard/ARIA behavior.
- Design: a new Kun composer visual treatment for the reasoning trigger and its popover in light and dark themes.
