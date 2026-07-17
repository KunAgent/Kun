# MotionFit Design System

A design system reconstruction of **MotionFit** — a futuristic fitness product centered on workouts, recovery, streaks, challenge tracking, and operational visibility.
The current library is purpose-built around a desktop dashboard interpretation, where training status, session metrics, roster signals, and next actions need to read instantly on dark, data-dense surfaces.

## Source

- **Figma library:** Source library metadata was not propagated in the orchestration summary.
- **Pages:** Page and top-level frame counts were not provided with the exported bundle.
- **Brand owner:** MotionFit

## What this design system covers

- **Foundations** — dual-accent color behavior anchored by `#ff4000` in the default theme and `#00ff85` in dark mode, `Orbitron` as the primary face, a `4px` spacing base, `0px` radius, near-flat shadows, and tight tracking at `-0.05em`.
- **Components** — 6 documented component families: Button, Card, Bottom Navigation, Input, Avatar, and Chip.
- **Sample kit** — the primary reference kit is the MotionFit dashboard at `ui_kits/dashboard/index.html`, supported by focused component previews for each documented pattern.

## CONTENT FUNDAMENTALS

### Voice & tone

MotionFit speaks like a performance console, not a lifestyle coach. The copy is short, directive, and metric-led, with a bias toward verbs, nouns, status labels, and operational summaries over conversational explanation. Even motivational moments stay disciplined: the product prefers phrases that signal action, readiness, or challenge framing instead of emotional reassurance. There is no evidence of playful punctuation, emoji, or chatty microcopy in the supplied source material. The tone is confident, futuristic, and competitive, which matches the hard-edged geometry, dark palette, and command-surface layout of the current dashboard kit.

### Concrete copy examples

- Workout entry point: *"Start Workout"*
- Recovery metric label: *"Recovery Score"*
- Habit retention metric: *"Daily Streak"*
- Search affordance: *"Search workout plans"*
- Program challenge label: *"May Sprint Challenge"*

### When generating copy

- Prefer short command phrases and metric labels over full explanatory sentences.
- Lead with the action or tracked concept: workout, recovery, streak, challenge, search.
- Keep wording tight enough to sit inside compact cards, dense tables, filter chips, and dashboard sidebars.
- Avoid emoji, jokes, and wellness clichés; the voice should feel disciplined, performance-oriented, and operationally aware.

## Visual Foundations

### Color

MotionFit is built around a deliberate dual-accent system instead of a single universal brand color. In the default theme, the primary accent is `#ff4000`, a hot orange that reads as effort, heat, and immediate exertion. In dark mode, the primary shifts to `#00ff85`, a neon green associated with progress, recovery completion, and system feedback. This split makes the library feel more like a training control interface than a generic brand skin: orange pushes action, while green signals optimized performance.

The surrounding palette stays intentionally narrow and dark. Core surfaces sit at `#292929`, `#161616`, `#0a0a0a`, and `#030303`, with primary text at `#e2e8f0` and muted copy at `#a1a1aa`. There is no soft gray office neutrality here; the neutrals are nearly black and exist to make the accents feel electric. Supporting chroma appears in chart colors such as `#d6ff0a`, `#6200ff`, `#00ff1e`, `#ff3def`, `#8a42ff`, and `#3b82f6`, giving analytical views a synthetic, performance-lab quality that fits the dashboard kit especially well.

Semantics are sparse and practical. Destructive remains `#ef4444`, while rings follow the active primary accent: `#ff4000` in the default set and `#00ff85` in dark mode. Sidebar tokens extend the same logic, with `--sidebar` at `#030303` or `#0a0a0a` and `--sidebar-primary` aligned to the active accent. The overall color mood is high-intensity and machine-like, with contrast doing more work than tonal delicacy.

### Typography

The defining type choice is **Orbitron**, exposed as `--font-sans` and carrying most of the library's visual identity. Orbitron brings a techno, uppercase-friendly personality that suits scoreboards, stat tiles, challenge names, section headers, and navigation labels. It is not a neutral UI sans; it announces the product's futuristic ambition every time a metric or action appears.

For fallback roles, the exported token set also exposes **serif** for serif content and **monospace** for mono contexts, but no additional branded Latin or numeric face is specified. There is also a notable gap in the token data: the source includes family tokens but does not include a font size scale, explicit weight tokens, or line-height tokens. That means typography in this library is defined more by family character and spacing pressure than by a fully documented hierarchy system.

When implementing the system, Orbitron should remain the first choice for display-oriented UI and dashboard labels. If Orbitron is unavailable in the target environment, a geometric sans fallback should be substituted to preserve the compact, engineered feeling, with the caveat that the result will feel less distinctive than the original token intent.

### Spacing

Spacing is built on a `4px` base unit, exported as `--spacing: 0.25rem`. That immediately positions MotionFit on the denser end of interface design: it is optimized for dashboards, stacked stats, quick filters, schedule views, search bars, and route switching rather than airy editorial layouts. The dashboard sample reinforces that reading through compact side navigation, tight card padding, and close label-to-value relationships.

Because no explicit component height tokens were propagated, spacing has to carry the density rules indirectly. In practice, the `4px` base suggests tight internal padding, compact action clusters, and table-friendly rhythms that keep workout and recovery information visible without visual slack.

### Radius

- **`0px`** — the entire system is locked to hard corners, which makes surfaces feel mechanical, strict, and performance-driven rather than friendly.
- **`0px`** — cards, buttons, inputs, chips, panels, and navigation all inherit the same sharp geometry, reinforcing a uniform industrial silhouette.
- **`0px`** — the lack of softening is not an omission; it is the core brand decision that separates MotionFit from rounded wellness apps.

### Shadow / Elevation

MotionFit technically exposes multiple shadow tokens, but their visual effect is intentionally close to zero. The exported shadow family repeats the same underlying construction with `2px` x-offset, `2px` y-offset, `0.5rem` blur, `0.1rem` spread, and a shadow color of `#000000` at `0` opacity. In the CSS output, those shadows resolve into values such as `2px 2px 0.5rem 0.1rem rgba(0, 0, 0, 0)`, confirming that hierarchy is not communicated through soft elevation.

This is an important philosophical cue: MotionFit separates layers through contrast, borders, and accent placement, not through ambient depth. Panels, cards, and tables read as distinct because they sit on darker or lighter black-based surfaces, not because they float.

### Borders

- Borders are dark and restrained, with tokens landing at `#292929` in the default set and `#27272a` in dark mode.
- The border system behaves as a structural separator more than a decorative stroke, helping hard-edged surfaces remain legible without adding softness.
- Ring colors mirror the active accent, so focus states stay vivid even when borders remain quiet.

### Backgrounds

- Primary surfaces range from `#030303` to `#292929`, creating a layered dark environment instead of a single black canvas.
- Cards, popovers, and panels stay close to black, which keeps metrics and action accents visually dominant.
- Sidebar surfaces follow the same logic, with accent and border tokens tuned to preserve contrast inside dashboard navigation contexts.

### Animation

- No motion tokens were propagated in the source bundle, so animation timing, easing, and duration cannot be treated as canonical design decisions.
- The absence of motion tokens suggests that the brand signature depends more on contrast, geometry, and typography than on animated behavior.
- Any future motion added to the system should stay crisp and restrained so it does not conflict with the disciplined visual language.

### Iconography

- No icon assets were included in the propagated variable data, so the library cannot document a canonical icon family here.
- Where icons appear in implementation, they should follow the same sharp, technical, minimal approach as the rest of the system.
- Accent usage should remain sparse: one bright color per interaction zone is enough to preserve the brand's synthetic training-lab feel.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Buttons turn the accent system into direct action language, pairing compact density with assertive contrast. |
| Card | `preview/component-card.html` | Cards are metric-first surfaces that rely on dark tonal separation rather than depth-heavy elevation. |
| Bottom Navigation | `preview/component-bottom-nav.html` | Bottom navigation remains documented as an inferred pattern, but the library's primary sample experience now prioritizes desktop dashboard navigation. |
| Input | `preview/component-input.html` | Inputs support search, planning, and goal entry with tight spacing and high-contrast framing instead of soft affordances. |
| Avatar | `preview/component-avatar.html` | Avatars act as identity markers for profile, roster, and leaderboard moments without breaking the hard-edged system language. |
| Chip | `preview/component-chip.html` | Chips express training filters and selection states through accent shifts inside an otherwise rigid geometry. |

## Index

- `README.md` — this brand narrative and implementation briefing.
- `colors_and_type.css` — CSS custom properties for color, type family, radius, shadow, spacing, and tracking.
- `css.json` — programmatic token export for automated tooling and transforms.
- `components/index.json` — component inventory plus shared cross-component patterns.
- `components/button.json` — action component structure and variant dimensions.
- `components/card.json` — surface component structure for metrics, sessions, and challenges.
- `components/bottom-nav.json` — inferred navigation pattern data carried over from the component export set.
- `components/input.json` — input pattern data for text, search, and planning entry.
- `components/avatar.json` — identity pattern data for profile and roster contexts.
- `components/chip.json` — selection pattern data for filters and toggles.
- `preview/component-button.html` — Button preview page.
- `preview/component-card.html` — Card preview page.
- `preview/component-bottom-nav.html` — Bottom Navigation preview page.
- `preview/component-input.html` — Input preview page.
- `preview/component-avatar.html` — Avatar preview page.
- `preview/component-chip.html` — Chip preview page.
- `ui_kits/dashboard/index.html` — primary click-through MotionFit dashboard reference for operations, analytics, and plan management.

## Caveats / known substitutions

1. **Source metadata gaps:** The orchestration summary does not include the original Figma filename, page count, or frame count, so the Source section documents those fields as unavailable rather than inferred.
2. **Typography gaps:** The source defines font family tokens, but no font size scale, no explicit weight tokens, and no line-height tokens were propagated. Any production hierarchy needs supplemental typography specs.
3. **Motion gaps:** No motion tokens were provided, so animation behavior is intentionally excluded from the canonical foundation summary.
4. **Component provenance:** The component set is inferred from tokens and exported component data because the source file did not include page layouts or component spec pages.
5. **Font substitution risk:** Orbitron is named explicitly, but if it is unavailable at implementation time, a geometric sans fallback will reduce the brand's techno character.
6. **Asset coverage:** No icons were present in the propagated available-variable data, so iconography guidance here is stylistic rather than asset-specific.
