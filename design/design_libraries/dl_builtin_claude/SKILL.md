---
name: "claude-design-system-design"
description: "Use this skill to generate well-branded interfaces for the Claude Design System (Anthropic-inspired aesthetic). Includes the full theme tokens, component specs, previews, and UIKit references for warm, editorial, conversation-first UI."
---

# Claude Design System Design Skill

Use this skill whenever you need an interface that should feel like **Claude** — warm, calm, editorial, and intellectually credible rather than slick, neon, or futuristic.

It works best for **AI chat interfaces, reading-first product surfaces, and thoughtful application UI**.

> "Make the interface feel like a beautifully typeset book."

## How to use this skill

Always work from the source files in this library. Do not invent token values or component structure.

1. **Load the tokens.** Link or inline `colors_and_type.css`. Use its CSS variables for all theme decisions.
2. **Check the component definition.** Read `components/<slug>.json` for variants, token mapping, and copy guidance.
3. **Copy the preview patterns.** Use `preview/component-<slug>.html` as the implementation baseline for markup and styling.
4. **Compose at screen level.** Use `ui_kits/app/index.html` for the mobile app reference and `ui_kits/website/index.html` for the desktop website / web app reference available in this library.
5. **Apply the essentials.** Preserve editorial typography, open spacing, quiet hierarchy, and restrained brand emphasis.

When creating visual artifacts, make them standalone and copy only the assets you need. When working in product code, use this library as the design reference rather than shipping it verbatim.

## File map

| You want to… | Read / use |
|---|---|
| Apply the theme tokens | `colors_and_type.css` |
| Access token data programmatically | `css.json` |
| Understand available components and system rules | `components/index.json` |
| Inspect component variants and token mappings | `components/<slug>.json` |
| Reuse working markup and styling | `preview/component-<slug>.html` |
| Reference a mobile app composition | `ui_kits/app/index.html` |
| Reference a desktop website / web app composition | `ui_kits/website/index.html` |
| Reuse existing icons in the current library | existing icon assets |

## Essentials at a glance

- **Primary accent:** terra-cotta `#C96442` in light mode and `#D97757` in dark mode. Use it as the single emotional accent.
- **Neutrals:** paper-like backgrounds, warm gray text, muted beige surfaces, and subdued borders do most of the structural work.
- **Type:** `Newsreader` for display emphasis, `Poppins` for compact UI, `Lora` for reading surfaces, and `Geist Mono` for code or token references.
- **Spacing:** a `4px` base rhythm (`0.25rem`) that scales into generous, breathable layouts.
- **Radius:** soft geometry spanning `8px`, `12px`, `16px`, `20px`, and `24px`.
- **Shadows:** quiet and paper-like, for separation rather than spectacle.
- **Voice:** warm, calm, editorial, honest, and trustworthy.
- **Brand behavior:** conversation-first UI; reading comfort matters as much as control clarity.

## Components

Each component has a JSON definition and a preview HTML file. Read both before building.

| Slug | Name | Key insight |
|---|---|---|
| button | Button | Lightweight controls rely on color and spacing rather than heavy visual chrome. |
| card | Card | Cards should create float / sink / emphasis hierarchy, not blanket containment. |
| input | Input | Use tonal separation before adding border complexity. |
| badge | Badge | Badges behave like concise editorial labels. |
| chat-bubble | Chat Bubble | The most brand-specific pattern: quiet, readable conversation surfaces. |
| navigation | Navigation | Navigation should stay structural, calm, and reading-friendly. |

## Cross-component rules

- Use serif-led reading surfaces and reserve sans-serif for compact UI.
- Avoid nested borders when tonal separation can do the job.
- Let neutrals carry most of the interface and use the primary accent sparingly.
- Prefer open composition over dense dashboard packing.
- Keep interaction readable, composed, and human.

## Caveats

- This skill reflects the files that currently exist in the `Claude-2` design system.
- The implementation source of truth is `colors_and_type.css` plus the component definitions in `components/`.
- The library includes six core components, their previews, two UIKit references, and existing icon assets in the current system.