## 1. Code-Only Control Structure

- [x] 1.1 Add the Code-only `split` model-control variant while preserving the combined presentation for every other composer.
- [x] 1.2 Refactor the picker overlay state so Code model and reasoning popovers share capability resolution and cannot be open together.
- [x] 1.3 Keep existing model grouping, search, setup guidance, vision safeguards, declared-default effort fallback, and model-switch normalization intact.

## 2. Minimal Reasoning Rail

- [x] 2.1 Add pure canonical effort ordering, even rail-position mapping, nearest-pointer selection, and keyboard movement helpers with `auto` at the far-right stop.
- [x] 2.2 Implement the Code-only borderless model and reasoning text triggers, model-only menu, and viewport-clamped reasoning portal.
- [x] 2.3 Implement click/drag snapping, slider ARIA, outside dismissal, Escape focus return, and active-turn next-input availability.

## 3. Visual System

- [x] 3.1 Add token-aware borderless toolbar, soft borderless popover, blue-to-magenta rail, fill, thumb, and clipped bubble styles.
- [x] 3.2 Add entry, fill/thumb, and bubble motion plus reduced-motion overrides for light and dark themes.
- [x] 3.3 Match the approved compact reference with `更快` / `更智能` endpoints, supported-stop nodes, and no title, logo, adaptive control, effort-name labels, visible border, or anchor notch.
- [x] 3.4 Enhance the rail with an always-visible blue-to-magenta gradient, independently animated bubbles, and a clipped layered sweep light while keeping the effect bounded and non-interactive.
- [x] 3.5 Make the rail color layer visibly travel across the whole fill in a linear, seamless, continuously looping blue-to-magenta cycle.
- [x] 3.6 Gate gradient, sweep, and bubble ambience to canonical `high`, `max`, and `auto` efforts while keeping `off`, `low`, and `medium` solid blue and static.

## 4. Verification And Documentation

- [x] 4.1 Update component and pure-helper tests for Code split rendering, unchanged combined rendering, sparse effort mapping, `auto`, keyboard behavior, and placement.
- [x] 4.2 Run the focused Vitest suite and `npm run typecheck`, then manually verify Code light/dark, narrow width, zoom, busy, model switches, pointer/keyboard, reduced motion, and next-turn reasoning request behavior.
- [x] 4.3 Synchronize proposal, design, specification, and tasks with the approved Code-only minimal rail design.
- [x] 4.4 Verify the enhanced rail in light and dark themes, confirm independent bubble motion and reduced-motion overrides, and rerun focused tests plus typecheck.
- [x] 4.5 Sample the rendered color layer at multiple animation times to confirm visible movement and a seamless loop, then rerun focused checks and build validation.
- [x] 4.6 Add effort-gating coverage and visually verify a calm medium state against an energized high state before rerunning focused checks.

## 5. Active-Turn Next-Input Controls

- [x] 5.1 Update the proposal, design, and specification so active-turn model and reasoning changes explicitly apply only to the next submitted turn.
- [x] 5.2 Decouple model and reasoning availability from the active-turn busy gate while preserving unrelated execution-setting gates.
- [x] 5.3 Add regression coverage proving the busy Code composer keeps both split controls enabled and snapshots their selections into the next queued input.
- [x] 5.4 Run the focused composer and queued-message tests plus renderer typecheck.
