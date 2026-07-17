---
name: "Claude Design System"
---

# Claude Design System

A design system reconstruction of **Claude** — Anthropic's AI assistant — designed to feel warm, calm, editorial, and intellectually credible rather than slick, cold, or futuristic. It is best suited to **AI chat interfaces, reading-first product surfaces, and thoughtful application UI**.

> "Make the interface feel like a beautifully typeset book."

### Source
Reconstructed from Claude brand cues and generated library artifacts. This library focuses on the theme foundations, six core components, their preview files, and two UIKit composition references.

### What this library includes
- A full token theme in `colors_and_type.css`, including primitive scales, semantic tokens, typography, radius, spacing, shadows, and dark mode.
- Machine-readable token output in `css.json`.
- Six component definitions in `components/*.json`.
- Matching HTML previews in `preview/*.html`.
- Two composed UIKit references in `ui_kits/app/index.html` and `ui_kits/website/index.html`.
- Existing icon assets for reuse in the current library.

## 1. How to use this system

When generating or restyling Claude UI, use the files in this library as the source of truth instead of inventing values.

1. **Load the tokens** — link or inline `colors_and_type.css`. All color, typography, radius, spacing, and shadow decisions should come from these variables.
2. **Read the component definition** — open `components/<slug>.json` for variant structure, token mapping, and sample copy.
3. **Reuse the preview markup** — take implementation cues from `preview/component-<slug>.html`.
4. **Compose from the UIKit references** — use `ui_kits/app/index.html` for the mobile app composition and `ui_kits/website/index.html` for the desktop website / web app composition.
5. **Apply the system rules** — preserve editorial warmth, quiet hierarchy, open spacing, and a single terra-cotta accent.

## 2. Content fundamentals

### Voice & tone
Claude copy should feel thoughtful, restrained, and quietly helpful. The tone is warm without being playful, intelligent without being academic, and calm without becoming vague. It should sound like a well-edited product rather than a high-energy SaaS dashboard.

### Copy behavior
- Prefer plain nouns and concise verbs over promotional phrasing.
- Keep labels short and readable.
- Write prompts and helper text with calm confidence.
- Avoid hype, forced friendliness, and ornamental language.

### Example phrases
- "Start a new chat"
- "Summarize the notes"
- "Draft a clearer version"
- "Warm, restrained, like reading a book."

## 3. Visual foundations

### Color
The theme is built around a single emotional accent: terra-cotta `#C96442`. That accent carries the Claude / Anthropic warmth, while the rest of the interface depends on layered neutrals and low-contrast surfaces. The token system provides both primitive scales and semantic variables so implementations can stay expressive without drifting away from the brand.

Light mode centers on paper-like backgrounds, soft beige cards, warm gray borders, and dark reading text. Dark mode keeps the same emotional temperature by using warm charcoals instead of pure black. Supporting status colors exist, but they should behave like annotations rather than a competing palette.

### Typography
Typography is the clearest expression of the theme. This system uses:

- **Newsreader** for display moments, headlines, and editorial emphasis
- **Poppins** for compact UI labels, controls, and utility text
- **Lora** for reading surfaces and longer-form content
- **Geist Mono** for code, token references, and technical annotation

Hierarchy should come from size, spacing, and contrast more than heavy weight. Headlines should feel typeset and literary, not loud. Body copy should remain comfortable, measured, and readable across long conversational or editorial surfaces.

### Spacing
Spacing follows a `4px` base rhythm (`--spacing: 0.25rem`) and typically composes into `12`, `16`, `24`, `32`, `48`, and `64`. Layouts should feel open and breathable, with visible separation between conceptual blocks.

### Radius
The system uses softened geometry:

- `8px` and `12px` for smaller controls
- `16px` as the core radius
- `20px` and `24px` for softer, more prominent surfaces

Corners should feel humane and contemporary, never sharp and never bubbly.

### Shadow
Shadows are subtle and paper-like. Use elevation for separation, not spectacle. The theme provides quiet shadow layers from `shadow-2xs` through `shadow-2xl`, all intended to support readability and hierarchy rather than glossy product theatrics.

### Surface behavior
- Prefer tonal separation before adding extra borders.
- Avoid nested border stacks.
- Introduce cards only when containment improves comprehension.
- Keep the page feeling open, not boxed in.

## 4. Component patterns

Each component in this library has a JSON definition and a matching preview file. Read both before implementation.

| Component | Definition | Preview | Key insight |
|---|---|---|---|
| Button | `components/button.json` | `preview/component-button.html` | Lightweight controls rely on clear action hierarchy, with disabled states reducing urgency without losing label readability. |
| Card | `components/card.json` | `preview/component-card.html` | Cards use more generous title, description, and grouping spacing so information hierarchy feels steadier and more breathable. |
| Input | `components/input.json` | `preview/component-input.html` | Inputs should separate through surface tone before resorting to nested borders. |
| Badge | `components/badge.json` | `preview/component-badge.html` | Badges should read like refined editorial chips, with compact warmth and consistently legible text. |
| Chat Bubble | `components/chat-bubble.json` | `preview/component-chat-bubble.html` | Conversation styling should keep body copy and meta clearly tiered, with primary messages preserving crisp text contrast. |
| Navigation | `components/navigation.json` | `preview/component-navigation.html` | Navigation should keep default, hover, and active states quietly distinct so structure reads at a glance. |

## 5. File map

| File or folder | Purpose |
|---|---|
| `colors_and_type.css` | Primary theme source: primitive scales, semantic tokens, fonts, radius, spacing, shadows, and dark mode |
| `css.json` | Machine-readable token inventory for tooling and scripts |
| `components/index.json` | Component inventory and cross-component rules |
| `components/*.json` | Per-component definitions, variants, token mapping, and copy samples |
| `preview/*.html` | Standalone previews showing working markup and styling |
| `ui_kits/app/index.html` | The mobile app-level composition reference available in this library |
| `ui_kits/website/index.html` | The desktop website / web app composition reference available in this library |
| existing icon assets | Reusable icons already present in the current library |

## 6. Cross-component rules

- Use editorial typography: display serif for emphasis, serif for reading, sans-serif for compact UI.
- Keep emphasis focused on the terra-cotta primary accent.
- Let neutrals do most of the structural work.
- Prefer open layouts over dense dashboard packing.
- Make interaction feel calm, readable, and trustworthy.
- Lower interactivity in disabled states through tone and emphasis, not by sacrificing text legibility.

## 7. Caveats

- This library reflects the files currently present in the `Claude-2` design system.
- The implementation source of truth is the token CSS and component definitions in this directory.
- The library covers six core components plus two UIKit composition references, not the entire Claude product surface.
- Claude and Anthropic naming are used here to describe the intended aesthetic direction; this library is an independent reconstruction for design-system use.
