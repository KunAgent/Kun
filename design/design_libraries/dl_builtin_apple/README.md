# Pinguo Design System

A design system reconstruction of **Pinguo** — a consumer imaging product ecosystem shaped around creation, merchandising, and device-like product storytelling.

> *"Content first, whitespace is design, restraint is style."*

### Source
- **Library source:** structured-spec bundle for Pinguo Apple
- **Page count:** not provided in the current source package
- **Brand owner:** Pinguo

### What this covers
- **Foundations** — a restrained palette built on Apple's Human Interface Guidelines system colors, organized into six token categories (`brand`, `background`, `text`, `icon`, `state-success`, `state-error`); DM Sans and JetBrains Mono; a `0.24rem` spacing base; a global radius token of `1.2rem`; and quiet shadow variables from `shadow-2xs` through `shadow-2xl`
- **Components** — 6 documented patterns: Button, Card, Input, Navigation, Product Grid, and Comparison Table
- **Sample kit** — the system includes an interactive `website` kit example in `ui_kits/website/index.html`

## CONTENT FUNDAMENTALS

### Voice & tone
Pinguo speaks in a controlled editorial register that borrows the calm confidence of premium hardware retail. Headlines are short, composed, and willing to break across lines for rhythm instead of completeness. Supporting copy is commerce-aware rather than conversational: it explains value, pricing context, delivery, or comparison logic without sounding pushy. The brand does not rely on slang, emoji, or playful filler. Even promotional moments stay measured, which keeps the interface feeling product-led rather than campaign-led.

### Concrete copy examples
- Store merchandising: *"Shop the latest"*
- Product education CTA: *"Learn more ›"*
- Choice architecture: *"Compare models"*
- Pricing program: *"Education pricing"*
- Service reassurance: *"Delivery, returns, installments"*

### When generating copy
- Keep headlines short enough to support deliberate line breaks and wide surrounding whitespace.
- Use concise merchandising labels before major headlines when a section needs rhythm or category framing.
- Prefer commerce language that clarifies price, delivery, model choice, or support over lifestyle filler.
- Reserve heightened energy for launches or hero moments; the default voice should stay calm and exact.

## VISUAL FOUNDATIONS

### Color
Color is intentionally narrow. The brand anchor is **Pinguo Blue** `#0066cc`, used as the clearest signal for action, emphasis, and commerce-aware highlights. It sits against a premium neutral frame defined by **Space Black** `#0a0a0a`, **Silver Mist** `#f5f5f7`, and **Ink Gray** `#3a3a3c`, which means most screens read as black, white, or soft gray before blue ever appears. Warm contrast is available through **Sunset Gold** `#f5b35a`, and supporting reassurance can come from **Forest Green** `#2f6b4a`, but the source guidance is explicit that no page should lean on more than two main hues and that warm and cool image treatments should not be mixed in the same composition.

The current artifact set exposes semantic token roles such as `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and a set of sidebar roles, rather than a published multi-stop brand ramp. That matters for implementation: the system is optimized for semantic application and restrained substitution, not for decorative color variety. Gradients are allowed only in hero or banner moments, while dark themes depend on high text contrast and disciplined secondary grays instead of color saturation.

### Typography
The primary typeface is **DM Sans**, which carries nearly all interface and merchandising copy. In the current summary, the most explicit weight usage is **600** for hero display settings and **400** for body copy, which already describes the intended hierarchy: bold enough to shape headlines, regular enough to keep dense product and support content readable. **JetBrains Mono** is the named mono companion and should be reserved for code-like, technical, or data-adjacent moments rather than broad UI text.

The typography system prioritizes proportion over ornament. Hero display is specified at **72–96px / 600 / -0.04em / 0.92**, which signals oversized, tightly tracked headings with strong vertical compression. Body text sits at **14–16px / 400 / 1.55**, giving product descriptions and commerce details enough air to feel premium without drifting into editorial looseness. The source rules add that display typography always uses negative tracking, eyebrows stay uppercase with expanded tracking, and italic is generally avoided. The available variable inventory also includes `font-sans`, `font-serif`, and `font-mono`; however, only DM Sans and JetBrains Mono are explicitly named in the current source summary, so those are the only families that should be treated as confirmed.

### Spacing
Spacing is governed by restraint rather than density for its own sake. The token highlight identifies a **`0.24rem` base**, while the structured foundation scale expands through **4, 8, 12, 16, 24, 32, 48, 64, 96, and 128**. In practice, that produces broad merchandising rhythm: large section gaps, careful product breathing room, and internal card spacing that relies on white space more than divider lines. The layout model reinforces that reading with a **12-column web grid** and **4-column mobile grid**, plus a page flow that moves from hero to category chips, product matrix, lifestyle banner, comparison, support, and footer.

On mobile, the guidance stays device-aware. The reference frame is **390 × 844pt**, with a **44pt** status area, a **48pt plus safe area** tab bar, and a **44 × 44pt** minimum touch target. This is consistent with the broader brand position: interfaces should feel physically deliberate, not merely visually minimal.

### Radius
- **`1.2rem`** is the explicit global radius token in the current summary, giving the system a softer, premium contour than a sharp enterprise UI.
- Small labels and inputs are described as using the tighter end of the radius scale, which keeps utility controls crisp even when the overall brand mood is elegant.
- Cards and hero media containers step into medium-to-large rounding, reinforcing the Apple-inspired hardware softness without becoming playful.
- Buttons remain fully pill-shaped, making actions read as tactile capsules within an otherwise restrained field.

### Shadow / Elevation
Elevation is intentionally quiet. The source philosophy states that cards are usually border-defined and shadow-light, and that stronger elevation is reserved for hover, drag, or overlays rather than resting states. This is supported by implementation variables ranging from `shadow-2xs` through `shadow-2xl` and by example values such as `0 1px 2px 0 rgba(0,0,0,0.04)`, `0 8px 24px -8px rgba(0,0,0,0.08)`, and `0 24px 64px -12px rgba(0,0,0,0.12)`.

The effect is less about stacking cards in Z-space and more about preserving a clean product stage. Border definition comes first, subtle depth comes second, and dramatic lift should be saved for moments when interaction or overlay logic genuinely needs it.

### Borders
- Use **1px** borders to define edges before reaching for shadow.
- Border presence is structural, not decorative; it clarifies card bounds, input edges, and navigation separation without adding visual noise.
- Rings and input tokens are present in the variable set, so focus treatment should stay visible and semantic rather than improvised.

### Backgrounds
- Most surfaces should remain black, white, or soft gray, with the lighter `background` steps (`background-100` / `background-200`, e.g. `#f2f2f7`) doing the work of a light merchandising field.
- Alternate light and dark sections to create pace, but avoid using more than three background colors on a single page.
- The system works best when backgrounds support product photography and typography instead of competing with them.

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | Capsule actions inherit the premium retail tone: decisive, rounded, and visually quieter than typical SaaS CTAs. |
| Card | `preview/component-card.html` | Cards are spacing-led containers whose premium feel comes from edge control and calm hierarchy, not decoration. |
| Input | `preview/component-input.html` | Inputs stay simple and readable, using contrast and focus clarity rather than heavy chrome. |
| Navigation | `preview/component-navigation.html` | Navigation borrows Apple Store restraint with a dark top bar and subdued secondary structure. |
| Product Grid | `preview/component-product-grid.html` | The grid turns merchandising into an editorial matrix, balancing product price, launch cues, and whitespace. |
| Comparison Table | `preview/component-comparison-table.html` | Comparison views calm technical choice by turning specs into an orderly product narrative rather than a dense matrix. |

## Index

- `README.md` — this brand narrative and implementation briefing
- `colors_and_type.css` — combined CSS tokens for color, type, spacing, radius, and shadow
- `css.json` — programmatic token representation aligned to the generated CSS
- `preview/component-button.html` — button preview card
- `preview/component-card.html` — card preview card
- `preview/component-input.html` — input preview card
- `preview/component-navigation.html` — navigation preview card
- `preview/component-product-grid.html` — product grid preview card
- `preview/component-comparison-table.html` — comparison table preview card
- `ui_kits/website/index.html` — complete website-style interactive reference
- `assets/icons/` — local SVG icon resources for shared interface use
- `components/index.json` — component index and cross-pattern summary
- `components/button.json`, `components/card.json`, `components/input.json`, `components/navigation.json`, `components/product-grid.json`, `components/comparison-table.json` — per-component structured analysis data

## Caveats / known substitutions

1. **Typeface coverage is partial.** The current source explicitly names **DM Sans** and **JetBrains Mono**, and exposes `font-serif` as a variable slot, but it does not name a confirmed serif family. Treat DM Sans and JetBrains Mono as authoritative and avoid inventing additional families.
2. **Icon and website references are present, but they are not the sole system baseline.** The library includes local SVG icon assets under `assets/icons/` and a `website` kit example at `ui_kits/website/index.html`; still, token files and component preview files should remain the primary design-system reference for implementation decisions.
3. **Use the website kit as a reference layer, not a replacement for the documented primitives.** `ui_kits/website/index.html` provides a complete interactive example, but the foundational source of truth remains the tokens and component previews that define the reusable system parts.
4. **Source metadata is incomplete.** The current package does not provide a Figma library filename or page count, so the provenance section is intentionally marked as structured-spec rather than a reconstructed Figma inventory.
5. **Some implementation roles are semantic rather than brand-named.** Variables such as `primary`, `secondary`, `accent`, `muted`, and `destructive` are available, but the summary does not publish a full named ramp for each role. Keep mappings conservative and grounded in the confirmed hex values above.
