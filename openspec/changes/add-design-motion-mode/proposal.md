## Why

Design mode can create and arrange static native shapes, HTML artifacts, SVG artifacts, and prototypes, but it cannot author reusable time-based motion in the canvas. Adding a Figma-style Motion mode gives designers and the Kun agent one shared, inspectable timeline model instead of relying on opaque generated CSS, SVG-only SMIL, or a separate video workflow.

## What Changes

- Add a Motion authoring mode integrated into the existing Design canvas, toolbar, layers, inspector, persistence, undo/redo, and handoff surfaces.
- Add per-frame timelines with property tracks, typed keyframes, easing, playback modes, presets, auto-key, play/pause/reset, and deterministic scrubbing.
- Preview motion non-destructively over the current canvas document without writing shape state on every animation frame.
- Support native canvas shapes and artifact/running-app frame containers in the first release; retain existing SVG document playback and Prototype navigation as separate compatible capabilities.
- When a selected standalone SVG contains its own SMIL/CSS animation, surface that inner playback state and preview controls inside the Motion dock while clearly separating it from editable outer container tracks.
- Add a bounded motion summary to the Kun turn context and structured Kun mutation tools so agent-authored and manually-authored motion share the same canonical data.
- Persist motion as validated versioned JSON, include it in canvas snapshots/handoff, and respect reduced-motion preferences.

## Capabilities

### New Capabilities

- `design-motion-timeline`: Motion mode UI, canonical timeline data, editing, preview playback, persistence, undo/redo, presets, and handoff behavior.
- `design-motion-agent-tools`: Structured Kun tools and operation-journal behavior for inspecting and mutating design motion timelines.

### Modified Capabilities

None.

## Impact

- Renderer Design canvas types, persistence, workspace state, toolbar, viewport rendering, layers, inspector, and new bottom timeline dock.
- Canvas undo/redo and operation-journal semantics for timeline mutations.
- Kun design tool schemas and renderer tool protocol/snapshot context.
- Design handoff/snapshot serialization and reduced-motion behavior.
- No new runtime provider and no replacement of existing Prototype or SVG animation paths.
