## Context

`FloatingComposerModelPicker` currently owns both model selection and reasoning effort. Its trigger concatenates the model label and effort label, while the menu opens a reasoning submenu beside the provider/model hierarchy. The underlying data path is already separate: model profiles declare supported reasoning efforts and a default, Workbench keeps `reasoningEffort` in session state, and turn submission captures the selected model and reasoning value before sending them through the existing Kun runtime contract.

The change is renderer-focused and intentionally limited to Code chat. It must preserve the one-Kun-runtime architecture, existing provider capability rules, non-Code composer variants, light/dark themes, and next-turn request semantics while a turn is busy.

## Goals / Non-Goals

**Goals:**

- Make model choice and reasoning effort separately visible and independently operable in Code chat.
- Give reasoning a direct, minimal energy-rail interaction without pretending that provider efforts are continuous numeric values.
- Reuse model-declared supported efforts, default fallback, and the current turn request field.
- Allow model and reasoning selection during an active turn while keeping the in-flight request immutable.
- Produce a responsive, keyboard-accessible, reduced-motion-safe interaction consistent with Kun's blue/violet accent and borderless toolbar controls.

**Non-Goals:**

- Add or change a provider reasoning protocol, request body, HTTP route, preload bridge, or SSE event.
- Add a second agent/runtime or an agent provider switcher.
- Invent unsupported intermediate effort values or alter provider model profiles.
- Change how a reasoning choice is stored or applied to turns already in progress.
- Change Design, Write, SDD, or Connect composer visuals.

## Decisions

### 1. Add a Code-only split presentation to the existing picker

Add `modelControlVariant: 'combined' | 'split'` to `FloatingComposer`, defaulting to `combined`. The Workbench Code route supplies `split`; every other caller retains the existing combined presentation. `FloatingComposerModelPicker` owns the model profile resolution, effort normalization, and a single active-overlay state so model and reasoning popovers cannot coexist.

This keeps the visual and state separation explicit without duplicating provider/model lookup logic. Keeping one combined trigger was rejected because it preserves the current discovery problem. Changing all shared composer call sites was rejected because Code is the requested scope.

### 2. Keep the model menu focused on models

In split mode, the model trigger displays only the current model (or provider setup state) plus a chevron, using no visible border, background, logo, or pill shape. Its menu retains provider grouping, model search, capability badges, vision-to-text switch protection, and provider setup guidance. Selecting a new model still normalizes the session effort to that model's supported set and declared default.

This preserves existing safety behavior and makes the model menu simpler. A flat combined model/effort matrix was rejected because it scales poorly with multiple providers and models.

### 3. Use a compact endpoint-labeled discrete energy rail

The reasoning trigger displays only `推理 · <localized effort>` plus a chevron; it has no logo, border, background, or pill shape. Its approximately 286 by 110 px popover is a soft, borderless floating surface centered over the trigger with no notch, title, effort-name labels, or Adaptive button. It has decorative `更快` and `更智能` endpoint labels above a blue-to-magenta capsule rail with a white thumb, pale remainder, supported-stop nodes, and clipped luminous bubbles.

The rail is discrete. The supported set is canonically ordered as `off`, `low`, `medium`, `high`, `max`, `auto`, deduplicated, and evenly distributed across visible nodes inset by the thumb radius. `auto` is always the far-right stop and is named only by the trigger. A free-running continuous slider was rejected because the backend accepts named efforts; a separate Adaptive button and per-effort text labels were rejected by the approved visual design.

### 4. Make direct manipulation and keyboard behavior equivalent

Pointer users can click the rail or drag the thumb; drag position snaps immediately to the nearest supported effort. The track exposes slider semantics with localized `aria-valuetext`; Left/Right and Home/End move among supported efforts. Escape closes the popover and returns focus to the reasoning trigger. The trigger reports its expanded state and current effort.

Using only decorative divs was rejected because it would make the central interaction inaccessible. A native range input was considered, but custom keyboard mapping is required to map sparse provider effort sets.

### 5. Use layered but bounded energy motion

Popover entry uses a 160 ms opacity/translate/scale transition. Changing effort moves the thumb and gradient fill over 220 ms with a soft overshoot curve. A bounded set of luminous bubbles drifts only within the filled rail; selection produces one short glow pulse. No motion affects layout or delays the value callback.

The base fill is solid Kun blue for `off`, `low`, and `medium`, matching the calm reference state. Selecting `high`, `max`, or `auto` adds an energized modifier: the base becomes blue-to-magenta, a two-copy color layer spans twice the fill width and translates by exactly one copy using a linear infinite animation, and sweep light plus bubbles become visible. The two color copies have identical stops, making the end frame visually identical to the start frame while colors visibly travel across every fixed point on the rail. Bubble elements use varied sizes, durations, delays, and travel vectors rather than sharing one synchronized drift, while remaining clipped inside the fill and ignored by pointer and assistive-technology input.

The energized decision is based on the canonical effort identifier, not the effort's position among the selected model's supported stops. This keeps `medium` calm and `high` energized even for sparse model profiles.

Under `prefers-reduced-motion: reduce`, entry and thumb transitions become immediate and overlay, sweep, drifting, and pulse effects are removed. This gives the requested liveliness without making the composer continuously distracting or creating a second source of state.

### 6. Follow existing capability, next-turn, responsive, and theme rules

The model and reasoning triggers preserve the existing profile fallback behavior and remain enabled whenever the composer has enough runtime/thread context to accept a future turn. The busy state does not disable them: the active request has already captured its model and reasoning values, so subsequent selections remain composer state for the next submitted or queued turn. Controls that mutate execution settings keep their existing busy-state rules. Model and reasoning triggers truncate independently, preserving adjacent Code toolbar actions. The popover is portaled and viewport-clamped using the existing zoom-aware placement pattern.

Colors use existing design tokens for surface, ink, muted text, hover, and focus. The rail uses the Kun accent family (blue into blue-violet) with theme-specific opacity rather than hard-coded white-only surfaces. Focus rings remain available to keyboard users even though the toolbar controls have no visible resting frame.

## Risks / Trade-offs

- [Two controls consume more horizontal space] -> Use independent truncation and existing composer breakpoints; never combine their text.
- [A slider-looking control could imply continuous values] -> Show discrete stop nodes, snap all input to supported presets, and expose named `aria-valuetext` values.
- [Supported effort subsets can make the track sparse] -> Evenly distribute only the supported canonical efforts and snap pointer/keyboard input to those stops.
- [Model changes can invalidate the current effort] -> Reuse the existing normalization helper and emit the model default immediately after the model selection changes.
- [Particles or glow can hurt performance or accessibility] -> Use a bounded number of CSS-only decorative elements, avoid timers, disable them for reduced motion, and keep them out of the accessibility tree.
- [Refactoring a mature picker can regress placement and provider setup] -> Preserve pure placement and grouping helpers, then extend focused component tests before visual QA.

## Migration Plan

1. Add the Code-only presentation prop and pure rail helpers with characterization tests.
2. Keep the combined branch unchanged; add model-only and reasoning-only controls in the split branch.
3. Add borderless toolbar and energy-rail styles, motion, and accessibility behavior.
4. Run component/unit tests and typecheck, then manually verify Code light/dark, narrow layouts, active-turn model/reasoning changes, provider setup, model switch, keyboard, pointer drag, zoom, and reduced motion.

Rollback is renderer-only: restore the combined picker while leaving state and runtime contracts untouched. No persisted-data migration is required.

## Open Questions

- None.
