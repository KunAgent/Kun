---
name: "tiktok-design"
description: "Use this skill to generate well-branded interfaces and assets for TikTok — a social video platform. Invoke it by scene (mobile feed / web discovery / editorial) or by reusing the bundled UI kit and components. All UI kit and component output is built on the icons in `/icons` and the tokens in `colors_and_type.css`."
---

# TikTok Design Skill

Generate UI and assets that stay recognizably TikTok. There are two ways to use this skill, and they share the same foundation:

1. **By scene** — pick a scene archetype below and follow its surface, layout, and component recipe.
2. **By UI kit / components** — reuse the bundled previews, component specs, and full app kit directly.

Both paths are **token-first** and **icon-first**: every color, type, spacing, and radius decision must trace back to `colors_and_type.css`, and every glyph must come from `/icons`. Never hardcode a hex value or invent an icon when a token or asset already exists.

If the user invokes this skill without other guidance, ask what they want to design, clarify the scene (mobile feed / web / editorial) and platform, then act like an expert product designer who outputs static HTML artifacts or production code.

## Invocation rule (default output)

Whenever this design theme/skill is used, **default to mobile output**: unless the user explicitly requests web or editorial, produce a mobile-first design and strictly use `ui_kits/app/index.html` as the design framework.

- **Framework reference (mandatory):** `ui_kits/app/index.html` is the canonical mobile frame. Reuse its phone-frame shell, status bar, top tab, right rail, bottom info, and bottom nav layout, density, radius, and content tone. Do not invent a new mobile layout when this kit already defines one.
- **Default surface:** mobile feed dark — `--video-bg` over the immersive area, white/alpha text, single bottom readability gradient.
- **Self-contained output:** keep the design tokens inlined (as in the current `ui_kits/app/index.html`) so the artifact renders on any platform without external relative-path CSS.
- **Override:** only switch to web discovery or editorial scenes when the user explicitly asks for a non-mobile platform.

## Foundation assets (always reference these)

| Asset | Path | Role |
| :-- | :-- | :-- |
| Color & type tokens | `colors_and_type.css` | Single source of truth for color, typography, semantic surfaces, and type metrics. `:root` = light, `.dark` = dark. |
| Token JSON | `css.json` | Programmatic mirror of the same token names. |
| Icon library | `/icons/*.svg` | 40 line icons, `stroke="currentColor"`, 2px stroke. The only icon source — do not substitute. |
| Component index | `components/index.json` | Component registry plus cross-component surface / type / motion / icon / content patterns. |
| Component specs | `components/*.json` | Per-component structure, sizing, and content rules. |
| Previews | `preview/component-*.html` | One rendered HTML preview per component. |
| App UI kit | `ui_kits/app/index.html` | Full click-through app reference for layout, density, and content tone. |

> **How UI kit and components consume the foundation:** every preview and the app kit link `colors_and_type.css` for color/type and pull glyphs from `/icons`. When you reuse or extend them, keep that wiring — change a brand color by editing the token in `colors_and_type.css` (the visual token editor in `linshi/` writes back to this file), and swap an icon by referencing a different file in `/icons`.

## Use by scene

Map the request to one of three scene archetypes, then assemble the listed components on the listed surface.

| Scene archetype | When to use | Default surface (token) | Recommended components | Reference |
| :-- | :-- | :-- | :-- | :-- |
| **Mobile feed** (short-video) | Immersive full-screen 9:16 feed, FYP, live | `--video-bg` `#0F0F12`, white/alpha text | Mobile Top Tab, Right Rail, Bottom Info, Bottom Nav | `ui_kits/app/index.html`, `preview/{top-tab,right-rail,bottom-info,bottom-nav}.html` |
| **Web discovery** | Explore grid, desktop browsing, tools | `--background` (`#FAFAFA` light / `#0B0B10` dark), `--foreground` text | Web Video Card, sidebar nav, trending rail | `preview/video-card.html` |
| **Editorial** | Posters, campaign covers, banners | Black-on-white or white-on-black per case | Editorial Mag Cover | `preview/editorial-cover.html` |

Scene rules:
- Only the **mobile feed** scene defaults to dark/black. Everything else defaults to `--background`. Never paint large areas with `--primary` / `--secondary` — red and cyan are ≤10% accent only.
- Mobile feed UI floats over video with a single bottom readability gradient; no top-bar blur.
- Editorial uses a 12-col grid, compressed display type, and at most one serif-italic emphasis word.

## Use by UI kit / components

Six documented components, each backed by a JSON spec and an HTML preview, all built on `/icons` + `colors_and_type.css`:

| Component | Spec | Preview | Icons used (from `/icons`) |
| :-- | :-- | :-- | :-- |
| Mobile Top Tab | `components/mobile-top-tab.json` | `preview/component-mobile-top-tab.html` | none (text-only tabs + 1px underline) |
| Mobile Right Rail | `components/mobile-right-rail.json` | `preview/component-mobile-right-rail.html` | `heart`, `message-circle-more`, `star`, `send-horizontal`, `user` |
| Mobile Bottom Info | `components/mobile-bottom-info.json` | `preview/component-mobile-bottom-info.html` | none (caption + hashtag color + audio marquee) |
| Mobile Bottom Nav | `components/mobile-bottom-nav.json` | `preview/component-mobile-bottom-nav.html` | `house`, `circle-play`, `message-circle-more`, `user` + publish key |
| Web Video Card | `components/web-video-card.json` | `preview/component-web-video-card.html` | `circle-play`, `heart` |
| Editorial Mag Cover | `components/editorial-mag-cover.json` | `preview/component-editorial-mag-cover.html` | minimal / none |

To reuse: copy the preview markup, keep `<link rel="stylesheet" href=".../colors_and_type.css">`, inline icons from `/icons` (or load equivalents), and preserve the documented sizing/rhythm. The signature publish button (white fill, black `+`, red-cyan ±3px offset) and text-only top tabs must not be replaced with gradients.

## Essentials at a glance

- Brand accent `--tk-red` `#FE2C55` + `--tk-cyan` `#25F4EE`; highlight-only, never fills or gradients.
- Default surface `--background` `#FAFAFA`; immersive video switches to `--video-bg` `#0F0F12` (not pure black everywhere).
- Core dark neutrals: `--tk-black` `#161823`, dark `--background` `#0B0B10`, `--card-elevated` `#1C1E2A`, `--border` `#262838`. Sharpness comes from rules and contrast, not heavy shadow.
- Type led by `--font-display` / `--font-sans` (Inter + TikTok fallbacks); display uses `--display-size` with `--display-letter-spacing: -0.02em`; body `--body-size` `14-15`, `--body-line-height` `1.6`.
- Editorial contrast from sparing `--font-serif` italic + `--font-mono` metadata; kicker `--kicker-size` `11`, uppercase, `--kicker-letter-spacing` `0.14em`.
- Spacing 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64; radius 2 / 6 / 8 / 12 + pill only when needed.
- Icons: `/icons/*.svg`, line style, 2px stroke, `stroke="currentColor"`; size by use (inline 14-16, nav 20-24, action rail 28-32).
- Motion vocabulary: marquee, heart pulse, disc spin, tab underline, chip swap; animate opacity/transform only, ≤3 visible animations per screen.
- Voice: real handles, captions, hashtags, counts, audio strings — never lorem ipsum or generic placeholder copy.
