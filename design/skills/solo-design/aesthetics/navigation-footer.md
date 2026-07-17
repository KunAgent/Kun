# Navigation Depth & Footer Patterns

> **Trigger**: Quality Gate 9 fires for every page (footer), or when page requires complex navigation (sidebar, mega-menu).

## Footer Patterns

### Minimal Footer (single-page / Landing / Showcase)
- One row: `©{year} {brand}` + 2–4 text links + social icons (if applicable)
- Height: 64–80px; `bg: --surface` or `--bg` with `--line` top border
- Links in `--ink-2`, hover `--ink`

### Standard Footer (multi-page site)
- 3–4 column grid: brand column (logo + tagline) + link groups + contact/CTA
- Height: auto; padding `--s-8` top/bottom
- Column headings: Caption weight 600 + `--ink-2`; links Body `--ink-3` → hover `--ink`
- Mobile: columns stack single-file; brand column first

### Rich Footer (enterprise / SaaS)
- Same as Standard + newsletter input + trust badges + secondary nav row
- Secondary nav row: legal links + language selector + back-to-top
- Max 5 columns; 6+ compresses into accordion on mobile

### Rules
- Every multi-page project must have a footer on every page (consistency)
- Footer links must be real (Privacy, Terms, Contact); no "Link 1 / Link 2"
- Social icons ≤ 5; use Lucide or simple SVG; 20px; `--ink-3`
- Footer must be `<footer>` element; accessible landmark

## Navigation Depth Patterns

### Sidebar Navigation
- Width: 240–280px (desktop); collapsible to 64px icon-only; hidden on mobile (hamburger)
- Active state: `--surface-2` bg + `--brand` left 3px bar OR `--brand` text; pick one
- Group headers: Caption `--ink-3` uppercase `letter-spacing: .08em`
- Depth: ≤ 2 nesting levels visible; 3+ uses drill-down or breadcrumb

### Mega Menu
- Trigger: hover (desktop), tap (mobile hamburger reveals full list)
- Max 4 column groups; each group ≤ 8 items
- One featured section (image + CTA) ≤ 1/3 width; rest text links
- Backdrop: `--surface` with `--shadow-3`; 240ms enter/leave

### Breadcrumb
- Position: below top nav, above page title; height 32–40px
- Separator: `>` or `/` in `--ink-3`; current page `--ink` no link
- ≤ 4 levels visible; overflow uses `...` with tooltip

## [FORBIDDEN]
- Footer with no real content (empty or single "©2024")
- Sticky footer overlapping content
- Navigation with > 3 visual emphasis styles simultaneously
- Hamburger menu on desktop viewport > 1024px
