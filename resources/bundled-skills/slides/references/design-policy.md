# Kun Presentation Core Design Policy

This policy is the stable design baseline for every Kun deck. Category guides and style references add scenario-specific guidance but cannot weaken these rules. The exact user request and supplied source material remain the content authority.

## 1. Evidence and source integrity

- Never invent facts, metrics, citations, customer examples, research results, or source URLs.
- Label missing evidence as a placeholder, assumption, or item to be supplied.
- Put the source, date or period, units, and measurement basis beside external facts and charts.
- Preserve the meaning of user-supplied evidence. Visual polish must never change or conceal it.

These evidence rules cannot be overridden by a style request.

## 2. Reader task and page strategy

- Give every slide one primary reader task and one primary judgment, question, or action.
- Build a narrative with deliberate pacing. Do not add a table of contents, divider, or closing page unless it serves the reader.
- Prefer a diagram, chart, table, or direct comparison when it explains a relationship more clearly than prose.
- Keep ordinary slides scannable. Split material before shrinking it into unreadable text.

## 3. Typography

- Declare display and body font roles; add a monospace role only when the subject needs code or identifiers.
- Use at most two non-monospace families unless the user's exact source establishes a brand system that requires more.
- Declare a numeric type scale with distinct title, section, body, and caption levels.
- Keep body and caption text readable at presentation distance. Do not use tiny text to rescue an overloaded slide.
- Use weight, size, alignment, whitespace, and thin rules before adding containers.

## 4. Color

- Declare stable semantic roles for background, foreground, accent, muted, and status colors.
- Declare the background treatment as solid, gradient, or image. Gradient color stops must be explicit.
- Use one structural palette throughout the deck; color must communicate meaning rather than decorate empty space.
- Maintain readable contrast for text, charts, and annotations. The declared foreground/background pair and the foreground against every gradient stop must meet WCAG AA contrast of at least 4.5:1.
- User brand colors take priority only when supported by the exact request or supplied materials.

## 5. Layout and spacing

- Declare a spacing unit, page margins, column count, and gutter before composing slides.
- Use stable title and content axes across related pages while varying rhythm according to content.
- Prefer direct placement, whitespace, alignment, and thin separators over nested panels.
- Keep diagrams, charts, tables, screenshots, and text editable whenever the PPTD format supports it.
- Never stretch raster assets; crop or contain them while preserving aspect ratio.

## 6. Imagery and charts

- Use user-provided imagery first when it is relevant and usable.
- Add imagery only when it advances the reader task; do not add decorative pictures to fill space.
- Keep imagery style and treatment consistent across the deck.
- Choose chart forms from the relationship in the data, remove default decoration, and label key values directly.

## 7. Default anti-patterns

The following patterns are forbidden by default:

- cards or rounded rectangles used merely to manufacture hierarchy or alignment;
- formulaic equal-width card grids when the content does not express equal peers;
- blue-purple gradients, cyan-purple neon, rainbow palettes, glowing borders, glassmorphism, particles, or ornamental grid effects used as generic "technology" styling;
- mixed icon systems, emoji as interface decoration, generic shadows, and gratuitous corner radii;
- full-slide raster flattening of editable text, charts, tables, or ordinary layout geometry;
- unsourced data, fabricated evidence, or citations that do not point to the claimed source.

A visual anti-pattern is acceptable only when the user's request or supplied brand material explicitly asks for it. Evidence integrity and editable-deliverable rules never accept exceptions.

## 8. Delivery

A deck is delivered only through `ppt_export` with `validated: true`. Report the slide count, where the pictures came from, and any QA warning that remains.
