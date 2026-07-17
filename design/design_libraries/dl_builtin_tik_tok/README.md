---
name: "TikTok Design System"
---

# TikTok Design System

A design system reconstruction of **TikTok** — a social video platform built around short-form, creator-led media.
The system is purpose-built for immersive mobile feed UI, lightweight web discovery cards, and editorial campaign surfaces that still feel native to the product.

> "The sound of now, the look of tomorrow." — source copy from `/data/user/work/tiktok/orchestration-summary.json`

## Source

- **Specification bundle:** structured-spec source captured in `orchestration-summary.json`, `css.json`, `components/index.json`, six component JSON files, six preview HTML files, and `ui_kits/app/index.html`
- **Artifact scope:** 16 generated artifacts covering foundations, component previews, component analysis, and one app UI kit
- **Brand owner:** TikTok

## What this design system covers

- **Foundations** — source token names such as `--tk-red`, `--tk-cyan`, `--video-bg`, `--font-display`, and `--font-sans`, plus semantic aliases like `--primary` and `--secondary`. All live in `colors_and_type.css` (`:root` = light, `.dark` = dark) and are mirrored in `css.json`.
- **Icons** — 40 line SVGs in `/icons` (`stroke="currentColor"`, 2px stroke). This is the single icon source; the UI kit and components inline from here.
- **Components** — 6 documented patterns spanning mobile navigation, action rails, content stacks, web video cards, and editorial covers
- **Sample previews & UI kit** — 6 preview files in `preview/` and one interactive app prototype in `ui_kits/app/index.html`

### How to consume it

This system can be used two ways, both built on the same foundation (`/icons` + `colors_and_type.css`):

1. **By scene** — pick a scene archetype and follow its surface + component recipe.
2. **By UI kit / components** — reuse the previews, component specs, and full app kit.

| Scene archetype | Default surface (token) | Components | Reference |
| :-- | :-- | :-- | :-- |
| **Mobile feed** (short-video) | `--video-bg` `#0F0F12` | Mobile Top Tab / Right Rail / Bottom Info / Bottom Nav | `ui_kits/app/index.html`, `preview/{top-tab,right-rail,bottom-info,bottom-nav}.html` |
| **Web discovery** | `--background` (`#FAFAFA` / `#0B0B10`) | Web Video Card + sidebar + trending rail | `preview/video-card.html` |
| **Editorial** | black-on-white / white-on-black | Editorial Mag Cover | `preview/editorial-cover.html` |

Every preview links `colors_and_type.css` for color/type and pulls glyphs from `/icons`. To restyle the brand, edit the token in `colors_and_type.css` (the visual token editor in `linshi/` reads and writes back to this file); to change an icon, reference a different file in `/icons`.

## CONTENT FUNDAMENTALS

### Voice & tone

TikTok’s interface voice is concise, creator-centric, and rhythm-aware. The observed copy does not read like a corporate product system; it reads like a platform that assumes live cultural context, fast scanning, and high visual turnover. Short labels such as "For You" and "LIVE" stay plain and direct, while longer lines feel like believable creator captions rather than marketing filler. Even when the UI becomes editorial, the tone remains sharp and contemporary instead of luxurious or ornamental. Emoji are notably absent from the exported navigation, metadata, and editorial examples, which suggests that emphasis should come from hierarchy, accent color, and timing rather than pictographic flourish.

### Concrete copy examples

- Feed tabs: *"Following"*, *"For You"*, *"LIVE"*
- Caption pattern: *"When the beat drops #fyp #viral"*
- Audio metadata: *"original sound · dance_queen"*
- Editorial/campaign line: *"The sound of now, the look of tomorrow."*
- Explore content title: *"Dance routine that broke the internet"*
- Editorial issue line: *"Issue 01 — Make your day"*
- UI kit refresh hint: *"Release to refresh"*

### When generating copy

- Keep labels short, plain, and highly scannable; navigation should usually land in one or two words.
- Prefer believable creator handles, counts, captions, hashtags, and audio strings over abstract platform messaging.
- Let culture and rhythm appear in the wording, but do not turn the UI into ad copy.
- Use uppercase mono kicker language sparingly for metadata, issue labels, or state chips.
- Avoid lorem ipsum, generic dashboard verbs, and placeholder strings that break product plausibility.

## Visual Foundations

### Color

TikTok’s color system is not a broad gradient-led palette; it is a restrained neutral field with two unmistakable accent signatures. The core brand pair is `--tk-red: #FE2C55` and `--tk-cyan: #25F4EE`, and both are meant to stay small in area and high in recognition. The documentation should preserve these source token names because they carry brand identity more clearly than generic aliases. In practice, `--primary` resolves to the same red and `--secondary` resolves to the same cyan, but the source names remain the more honest reference when describing the brand.

The working neutral base is built on `--background: #FAFAFA`, `--foreground: #161823`, and `--card: #FFFFFF`, which gives the system an editorial black-on-off-white clarity rather than a playful app-store polish. Immersive video scenes switch to `--video-bg: #0F0F12`, while dark-mode surfaces deepen to `--background: #0B0B10`, `--card: #161823`, and `--card-elevated: #1C1E2A`. Semantic status colors are spare: `--success: #10B981` and `--destructive: #E5484D` exist, but the source material makes it clear that the emotional center of the system still belongs to the red-cyan signature pair.

The overall color vibe is high-contrast, content-led, and disciplined. Large gradients are discouraged except for readability overlays on video, accent colors should not become page fills, and the system alternates between white-on-near-black and near-black-on-white with very little decorative color noise.

### Typography

Typography does most of the identity work. The exported stacks preserve source token naming and explicitly separate display, sans, serif, and mono roles. `--font-display` is `Inter, "TikTok Display", ui-sans-serif, sans-serif`, which means the intended branded face is TikTok Display but the active runtime substitution begins with Inter. `--font-sans` follows the same pattern as `Inter, "TikTok Sans", ui-sans-serif, sans-serif`, making Inter the pragmatic fallback for product UI if TikTok Sans is not locally available. `--font-serif` is `Georgia, Times, serif`, used as a rare italicized emphasis device, and `--font-mono` is `"JetBrains Mono", monospace`, reserved for kicker labels, metadata, and system rhythm.

The scale is partly tokenized and partly descriptive. `--display-size` is `clamp(48px, 7vw, 96px)` with `--display-weight: 600-700`, `--display-line-height: 0.95`, and `--display-letter-spacing: -0.02em`, which gives display moments an editorial compression rather than a billboard heaviness. Heading tokens are expressed as ranges: `--h2-size: 28-32`, `--h2-weight: 600`, `--h2-line-height: 1.15`, then `--h3-size: 18-20`, `--h3-weight: 600`, `--h3-line-height: 1.3`. Body copy sits at `--body-size: 14-15`, `--body-weight: 400`, `--body-line-height: 1.6`, while kicker text drops to `--kicker-size: 11` with `--kicker-letter-spacing: 0.14em` and uppercase transformation. The result is a system where size, tracking, and contrast do more work than excessive weight.

### Spacing

The spacing rhythm documented in the source summary is `4, 8, 12, 16, 24, 32, 48, 64`. Those values line up with the generated artifacts: web explore cards use an `8px` grid gap, the mobile right rail uses a `20px` stack gap as a component-specific expression between actions, the bottom navigation bar is `64px` tall, and the publish control is `48 x 32px`. This produces a system that feels tight and quick rather than airy. Most layouts hug the content, preserve room for video, and use spacing to maintain reading order instead of to create decorative luxury.

### Radius

The source summary describes the foundational radius set as `2, 6, 8, 12`, with pill shapes only when a pattern truly needs it. That makes the system restrained by default. `2px` belongs to hairline softness and micro accents, `6px` and `8px` handle compact UI surfaces, and `12px` gives slightly more ease to larger cards without turning the product soft or bubbly. Fully rounded `999px` pills appear for follow controls, LIVE labels, and compact chips because those elements read as distinct state objects rather than general containers.

The UI kit intentionally stretches beyond the foundational set in a few shell-level places, but those should be read as presentation framing for previews rather than the canonical token layer. The library now includes reusable radius tokens (`--radius-xs / sm / md / lg / xl / shell / pill`), with `--radius-shell` reserved only for UI kit outer shells; product containers should remain anchored to `sm / md / lg`.

### Shadow / Elevation

There is no exported shadow token family in `css.json`, and the design language behaves as if the default shadow philosophy is "almost none." Surfaces are usually separated by `1px` rules, contrast shifts, or the switch from `--background` to `--card`, not by stacked drop shadows. The most visible shadow in the generated library is the illustrative device shell shadow in `ui_kits/app/index.html`: `0 24px 60px rgba(22,24,35,.18)`. That shadow belongs to presentation chrome, not the product grammar itself. For real UI, prefer quiet borders, overlays, and depth through content layers.

### Borders

- Dark surfaces rely on `--border: #262838` for quiet separation rather than high-contrast outlines.
- The mobile top tab uses a `1px` active underline as its only state marker.
- Bottom navigation in immersive mode is divided with a thin top rule, not a raised container treatment.
- Web cards use a single border plus a readability fade instead of ornamental framing.

### Backgrounds

- Default product surfaces sit on `#FAFAFA` and `#FFFFFF`, which keeps editorial pages bright and neutral.
- Immersive media scenes use `#0F0F12` so white metadata can sit above video without turning the whole system pure black.
- Dark mode deepens to `#0B0B10` and `#161823`, maintaining contrast while preserving the same neutral character.
- Bottom readability overlays are allowed; decorative blur, glassmorphism, and broad gradient fills are not part of the core language.

### Animation

- Allowed motions from the source summary are scroll-marquee, heart-pulse, disc spin, tab underline, and chip swap.
- The UI kit turns that into specific timings: an `8s` disc spin, an `11s` marquee loop, and a `.35s` screen transition.
- Motion should stay limited to opacity and transform, and one screen should show no more than three visible animations at once.
- Reduced-motion states are explicit in the component JSON files and should remove ambient motion before removing information.

### Iconography

- Icons ship as 40 line SVGs in `/icons` (e.g. `heart.svg`, `house.svg`, `circle-play.svg`, `user.svg`, `message-circle-more.svg`, `send-horizontal.svg`, `star.svg`), each with a 2px stroke and `stroke="currentColor"` so they inherit color from context.
- The UI kit and component previews inline glyphs from this folder; do not substitute a different icon set or use textual stand-ins.
- Size by use: inline 14-16, navigation 20-24, action rail 28-32, hero 40+.
- Red is reserved for the heart/like emphasis, not for decorating every actionable icon.
- Icon containers are usually circular or chrome-light, allowing the content layer to remain dominant.

## Component Patterns

- **Mobile Top Tab** — `preview/top-tab.html` and `components/mobile-top-tab.json`: three text-only tabs with a `1px` underline keep navigation almost invisible over video.
- **Mobile Right Rail** — `preview/right-rail.html` and `components/mobile-right-rail.json`: avatar, engagement actions, and music disc stack vertically with `28-32px` icon sizing and a `20px` rhythm.
- **Mobile Bottom Info** — `preview/bottom-info.html` and `components/mobile-bottom-info.json`: captions, hashtags, and audio metadata occupy a bottom-safe block that leaves room for the right rail.
- **Mobile Bottom Nav** — `preview/bottom-nav.html` and `components/mobile-bottom-nav.json`: the five-item black bar centers the signature publish control with red-cyan offset layers.
- **Web Video Card** — `preview/video-card.html` and `components/web-video-card.json`: a `9:16` shell with minimal overlays keeps metadata compact and media-first.
- **Editorial Mag Cover** — `preview/editorial-cover.html` and `components/editorial-mag-cover.json`: a `4:3` editorial composition uses mono metadata, compressed display type, and highly selective accent words.

## Index

- `README.md` — this document
- `colors_and_type.css` — combined CSS variables for color, typography, semantic surfaces, and descriptive type metrics
- `css.json` — programmatic token export for colors, font families, and semantic roles
- `icons/` — 40 line SVG icons (`stroke="currentColor"`) used by the UI kit and components
- `components/index.json` — component registry plus cross-component patterns
- `components/*.json` — six per-component analysis files
- `preview/` — six HTML previews for component inspection
- `ui_kits/app/index.html` — interactive mobile-first reference kit

## Caveats / known substitutions

1. **`"TikTok Display"`** is referenced in `--font-display` but not shipped as a local file in this library. The runtime stack substitutes **Inter** first, so display compositions should be checked for line breaks when the branded face is unavailable.
2. **`"TikTok Sans"`** is referenced in `--font-sans` but also falls back to **Inter**. This keeps the UI coherent, but it reduces the distinction between branded product copy and neutral sans text.
3. **Source token naming is preserved intentionally.** `--tk-red`, `--tk-cyan`, and `--video-bg` should remain the preferred documentation names for brand identity, even though `--primary` and `--secondary` exist as semantic aliases.
4. **Radius, spacing, and several size tokens remain partly descriptive rather than fully atomic.** The canonical spacing rhythm (`4, 8, 12, 16, 24, 32, 48, 64`) and radius logic (`2, 6, 8, 12, pill`) come from the structured summary; reusable CSS radius tokens are now available in `colors_and_type.css`, with `shell` constrained to UI kit framing.
5. **Typography sizes and weights include range values.** Tokens such as `600-700`, `28-32`, `18-20`, and `14-15` are preserved as written instead of being falsely normalized into single hard values.
6. **Icons are line-style SVGs in `/icons`.** The library ships 40 glyphs with `stroke="currentColor"` and a 2px stroke; the UI kit and previews inline real SVGs from this folder rather than textual stand-ins.
7. **No foundation shadow token set is exported.** Elevation behavior is therefore documented from the generated artifacts as a border-first, shadow-minimal system instead of a multi-level shadow scale.
