# Goldentime Design Library Skill

## Purpose

Use this design library when generating interfaces, components, or page layouts for the Goldentime brand. The system is built for a warm, editorial, premium dashboard experience. Every output should feel composed, calm, and deliberate rather than generic, loud, or highly technical.

## Source of truth

Prioritize these artifacts in this order:

1. `/data/user/work/goldentime/orchestration-summary.json`
2. `/data/user/work/goldentime/available-variables.json`
3. `/workspace/.design_library/goldentime/css.json`
4. `/workspace/.design_library/goldentime/components/index.json`

## Required constraints

- Write all visible product copy in English.
- Use only the CSS variables already defined by the library.
- Do not invent new semantic tokens, color names, spacing scales, or component families.
- Keep the tone premium, editorial, and dashboard-oriented.
- Prefer sentence case labels and concise microcopy.
- Let warm neutrals carry the interface and reserve stronger contrast for hierarchy, action, or urgency.

## Brand profile

- Brand: Goldentime
- Theme direction: warm, editorial, premium, dashboard
- Signature type direction: Fraunces-led serif presentation with generous spacing
- Interaction character: restrained, confident, tactile, and calm

Goldentime should feel like a premium operations workspace for memberships, account stewardship, editorial reporting, and executive review. The interface should support analysis and decision-making without looking cold, corporate, or overly dense.

## Artifact manifest

The generated artifact set for this library is complete and should be treated as available:

- `/workspace/.design_library/goldentime/colors_and_type.css`
- `/workspace/.design_library/goldentime/css.json`
- `/workspace/.design_library/goldentime/components/index.json`
- `/workspace/.design_library/goldentime/components/button.json`
- `/workspace/.design_library/goldentime/components/card.json`
- `/workspace/.design_library/goldentime/components/input.json`
- `/workspace/.design_library/goldentime/components/sidebar-navigation.json`
- `/workspace/.design_library/goldentime/components/data-table.json`
- `/workspace/.design_library/goldentime/components/chart-panel.json`
- `/workspace/.design_library/goldentime/preview/component-button.html`
- `/workspace/.design_library/goldentime/preview/component-card.html`
- `/workspace/.design_library/goldentime/preview/component-input.html`
- `/workspace/.design_library/goldentime/preview/component-sidebar-navigation.html`
- `/workspace/.design_library/goldentime/preview/component-data-table.html`
- `/workspace/.design_library/goldentime/preview/component-chart-panel.html`
- `/workspace/.design_library/goldentime/ui_kits/dashboard/index.html`

## Design foundation

### Core visual principles

1. Warm neutral surfaces first.
2. Strong contrast only where hierarchy or action needs it.
3. Spacious internal rhythm over compressed density.
4. Editorial clarity over enterprise noise.
5. Consistent data storytelling, especially in dashboard modules.

### Token highlights

Use tokens from `/workspace/.design_library/goldentime/colors_and_type.css` and `/workspace/.design_library/goldentime/css.json`.

- Background surfaces: `--background`, `--card`, `--popover`
- Text: `--foreground`, `--card-foreground`, `--popover-foreground`, `--muted-foreground`
- Action and emphasis: `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground`
- Status: `--destructive`, `--destructive-foreground`
- Structure: `--border`, `--input`, `--ring`
- Data visualization: `--chart-1` through `--chart-5`
- Sidebar system: `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`
- Typography and rhythm: `--font-sans`, `--font-serif`, `--radius`, `--tracking-normal`, `--spacing`
- Shadows: `--shadow-2xs`, `--shadow-xs`, `--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-2xl`

### Practical token guidance

- Default to `--background` and `--card` for page and panel surfaces.
- Use `--primary` for the main action path only.
- Use `--secondary` for visible but not dominant supporting actions.
- Use `--accent` sparingly for hover, emphasis, and gentle highlights.
- Keep most supporting text on `--muted-foreground`.
- Use chart tokens only inside analytical views and maintain a stable series order across screens.

## Typography and spacing

- Primary family: `--font-sans` and `--font-serif`, both anchored by Fraunces.
- Letter spacing: `--tracking-normal`
- Radius: `--radius`
- Base spacing unit: `--spacing`

Composition should feel generous. Leave breathing room around titles, metrics, legends, and action groups. Avoid cramped tables, crowded forms, or long action rows with equal visual weight.

## Component system

Use `/workspace/.design_library/goldentime/components/index.json` as the catalog entry point.

### Button

File: `/workspace/.design_library/goldentime/components/button.json`

- Role: primary action control
- Variants: primary, secondary, ghost, destructive
- Best for: publish, save, export, review, archive
- Guidance:
  - Start labels with a verb.
  - Keep labels under three words when possible.
  - Reserve destructive styling for truly irreversible actions.

### Card

File: `/workspace/.design_library/goldentime/components/card.json`

- Role: premium dashboard container
- Best for: metrics, narratives, queue items, compact workflows
- Guidance:
  - Use cards to structure information calmly.
  - Maintain warm neutral surfaces and generous padding.
  - Avoid turning cards into noisy mixed-purpose containers.

### Input

File: `/workspace/.design_library/goldentime/components/input.json`

- Role: search, filter, and text entry
- Best for: dashboard search, profile fields, settings forms
- Guidance:
  - Keep borders quiet.
  - Preserve clear focus visibility.
  - Pair inputs with concise labels and validation language.

### Sidebar Navigation

File: `/workspace/.design_library/goldentime/components/sidebar-navigation.json`

- Role: persistent workspace navigation shell
- Best for: overview, analytics, reports, clients, settings
- Guidance:
  - Use short noun labels.
  - Keep the active state unmistakable.
  - The sidebar should support the main content, not dominate it.

### Data Table

File: `/workspace/.design_library/goldentime/components/data-table.json`

- Role: structured record review surface
- Best for: renewals, memberships, accounts, operational data
- Guidance:
  - Prioritize legibility and row scanning.
  - Use restrained emphasis for sorting, status, and selection.
  - Do not overuse saturated backgrounds inside dense tables.

### Chart Panel

File: `/workspace/.design_library/goldentime/components/chart-panel.json`

- Role: narrative analytics module
- Best for: executive summaries, trends, comparisons, performance readouts
- Guidance:
  - Titles should communicate the decision or takeaway, not just the chart type.
  - Pair visualized data with a short interpretive note.
  - Keep chart color usage disciplined and consistent.

## Recommended composition patterns

Reference the complete UI kit at `/workspace/.design_library/goldentime/ui_kits/dashboard/index.html`.

Preferred patterns:

- Sidebar plus topbar dashboard shell
- Hero summary band with one featured narrative panel and one operational support panel
- Three-up KPI card row
- Split layouts pairing tables with compact metrics or alerts
- Chart panel with legend, supporting narrative, and adjacent cohort notes
- Settings screens with clear separation between profile, preferences, billing, and destructive actions

## Copy guidance

Goldentime copy should sound:

- composed
- premium
- concise
- editorial
- operationally clear

Preferred examples:

- "Publish brief"
- "Review invoice"
- "Export summary"
- "Quarter narrative"
- "Renewal confidence is holding above target"

Avoid:

- robotic enterprise jargon
- overly promotional marketing language
- placeholder filler such as "Lorem ipsum"
- noisy all-caps control labels
- generic dashboard phrasing that ignores the premium editorial tone

## Accessibility rules

- Preserve visible focus using `--ring` or `--sidebar-ring` as appropriate.
- Do not rely on color alone to communicate state, status, or chart differences.
- Use semantic navigation, form, table, and button patterns.
- Ensure icon-only controls have accessible names.
- Keep text contrast and state communication readable in both default and dark themes.

## Do and do not

### Do

- Build dashboard experiences with strong information hierarchy.
- Reuse the defined component set before inventing new UI structures.
- Keep layout rhythm spacious and readable.
- Use warm accent states to create tactility without visual noise.
- Treat Fraunces as a premium signature and give it room.

### Do not

- Introduce bright unrelated color families.
- Create dense enterprise grids with minimal spacing.
- Replace the calm editorial voice with technical or sales-heavy language.
- Apply chart colors broadly outside data visualization contexts.
- Add new tokens when an existing one already fits.

## Implementation checklist

Before finalizing any Goldentime output, confirm that:

- All visible copy is in English.
- Only existing library variables are used.
- The design remains warm, editorial, premium, and dashboard-centered.
- Primary emphasis is limited to the most important actions.
- Supporting surfaces rely on neutrals and muted contrast.
- Components align with the provided JSON definitions.
- Charts, tables, and sidebars follow the patterns shown in the preview artifacts and dashboard UI kit.

## Quick start

When building a new Goldentime screen:

1. Load `/workspace/.design_library/goldentime/colors_and_type.css`.
2. Review `/workspace/.design_library/goldentime/components/index.json`.
3. Choose from button, card, input, sidebar-navigation, data-table, and chart-panel before creating any new pattern.
4. Follow the layout and copy tone from `/workspace/.design_library/goldentime/ui_kits/dashboard/index.html`.
5. Keep every interface in English and grounded in premium dashboard workflows.
