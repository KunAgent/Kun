/**
 * Stable authoring rules for Kun Design HTML pages.
 *
 * Kun attaches them once per run of reserved-page turns through the Design
 * page mode policy (`loop/design-html-page-mode.ts`). The renderer inlines the
 * same lines only into prompts Kun cannot attach a policy to, such as delegated
 * page children, by importing this module. Keep it free of imports so both
 * packages can load it.
 */

/**
 * Built-in design craft discipline (anti-AI-slop, color, type, layout, motion,
 * a11y, states). Injected into every design turn and DESIGN_SYSTEM.md so output
 * has a quality floor regardless of the preset or brief.
 */
export const DESIGN_CRAFT_LINES: readonly string[] = [
  'Design craft (apply unless the brief explicitly overrides):',
  '- Anti-AI-slop: no cream/sand default backgrounds, no purple→blue gradients, no glassmorphism-on-a-gradient, no center-everything layouts, no emoji as icons.',
  '- Color: one accent + a real neutral ramp; ≥4.5:1 text contrast; avoid pure #000 and gray text on colored fills.',
  '- Typography: a clear hierarchy (2–3 sizes), body line-height ~1.6, tighter headings; one or two families max.',
  '- Layout: a real grid, intentional whitespace, aligned to a baseline; avoid nested cards and uniform 16px-everywhere.',
  '- Motion: subtle and fast (≤200ms), ease-out; honor prefers-reduced-motion.',
  '- Accessibility: visible focus states, labels, hit targets ≥40px, semantic structure.',
  '- States: design empty / loading / error / hover / disabled, not just the happy path.'
]

/**
 * HTML artifacts live inside resizable canvas frames/webviews. This is stricter
 * than normal responsive design: the frame may be dragged to arbitrary sizes
 * after generation, so the document must react to container/viewport resize.
 */
export const DESIGN_RESIZE_RESPONSIVE_LINES: readonly string[] = [
  'Resize-adaptive HTML contract (mandatory for every final HTML artifact):',
  '- Treat the canvas frame/webview as a live, resizable viewport. The design must adapt when the frame is resized after generation, not only at first load.',
  '- Include `<meta name="viewport" content="width=device-width, initial-scale=1">` and CSS that lets `html`, `body`, and the top-level app/root fill the frame (`width:100%`, `min-height:100%`, no default body margin).',
  '- Do not lock the page to a fixed desktop canvas: avoid `width`/`min-width` above the frame width, avoid `height:100vh` + `overflow:hidden`, and avoid absolute layouts that cannot reflow.',
  '- Use fluid primitives: `%`, `min()`, `max()`, `clamp()`, `minmax()`, wrapping flex/grid, `max-width:100%`, `min-width:0`, and responsive media rules/container-aware sections.',
  '- Verify mentally at mobile (~390px), tablet (~768px), desktop (~1280px), and arbitrary resized frame sizes: no horizontal scroll, clipped text, overlap, or tiny tap targets.'
]

/**
 * Delivery bar for generated design artifacts. The craft lines say what "good"
 * looks like visually; these lines say what a complete product-design handoff
 * must contain so multi-page generation lands as usable work.
 */
export const DESIGN_DELIVERY_LINES: readonly string[] = [
  'Design delivery checklist (complete before you finish):',
  '- Document title: exported HTML must include a meaningful `<title>` with the product, brand, screen, or offer name; no Untitled/Draft/page-type titles.',
  '- Product intent: make the page goal, primary user action, and secondary escape path obvious without explanatory copy.',
  '- Secondary action path: in the first screen, pair the primary CTA with a clearly different secondary action such as view demo, see work, compare plans, read case study, or contact/schedule.',
  '- Brand identity: for landing, brand, portfolio, pricing, and marketing pages, make the product/brand/person name visible in the first viewport or header, not only generic nav links.',
  '- Brand navigation: for landing, brand, portfolio, pricing, and marketing pages, include a branded header/nav with section links and a primary action.',
  '- Product shell: for app UI, dashboards, admin tools, and workspaces, include real product chrome such as a top bar, sidebar, nav rail, breadcrumbs, search, user/status area, or workspace switcher.',
  '- Product navigation: for app UI, dashboards, admin tools, and workspaces, make navigation labels specific to the domain objects and workflows; no Dashboard / Analytics / Reports-only nav.',
  '- Breadcrumbs and page paths: for app UI and multi-screen prototypes, breadcrumb labels should name product areas, objects, records, or workflow stages; no Home / Dashboard / Details-only trails.',
  '- Data tables: for app UI, dashboards, admin tools, and workspaces, name columns after real domain fields; no Name / Status / Date / Action-only tables.',
  '- Record item titles: repeated queue, list, and card items should name concrete records, customers, tickets, invoices, or workflow tasks; no Item 1 / Task 2 / Record A-only lists.',
  '- Record actions: row, card, and list actions should name the next business task; no View / Details / More-only repeated actions.',
  '- Record discovery: for dense tables and lists, search, filters, sorts, saved views, and pagination should name searched objects or views; no Search / Filter / All statuses-only toolbars.',
  '- KPI cards: for app UI, dashboards, admin tools, and workspaces, metric labels should name business objects and periods; no Revenue / Users / Growth-only scorecards.',
  '- Chart specificity: chart titles, captions, axes, and legends should name the business metric, object, period, and comparison; no Chart / Data / Growth / Series 1-only visuals.',
  '- Visual anchor: for landing, brand, portfolio, pricing, and marketing pages, include a real product preview, image, gallery, or media-led hero visual instead of text-only cards or abstract blob/orb decoration.',
  '- Product preview detail: when using product previews, screenshots, mockups, or media panels, show real media or concrete UI/data details inside the preview; no empty framed placeholder shells or decorative-only SVGs.',
  '- Image semantics: non-decorative images need specific alt text that names the product, person, place, screen, or content shown; no generic "image", "screenshot", "hero image", or "product preview" labels.',
  '- Trust proof: for landing and marketing pages, include concrete customer logos, testimonials, ratings, case-study metrics, press, or security/compliance badges; no Logo 1 / Company A placeholders.',
  '- Proof metrics: avoid generic vanity stats like 99% satisfaction, 10x faster, 1M+ users, or 24/7 support unless they have a customer/source, timeframe, benchmark, or case-study context.',
  '- Testimonial attribution and proof: when using testimonials or customer quotes, include a named person or company, role/source, and concrete outcome context; no vague "amazing product" / "highly recommend" praise without a real workflow, metric, or timeframe.',
  '- Feature anatomy: for landing, brand, product, feature, and marketing pages, include concrete feature/benefit/use-case sections with named capabilities, user outcomes, and product-specific details; no generic Automation / Analytics / Security cards without product objects or workflow detail.',
  '- Portfolio/case-study anatomy: for portfolio and case-study pages, include real project entries with client, role/category, timeline/year, visual, outcome metric, and detail CTA; no Project One / Client A / Case Study placeholders.',
  '- Pricing anatomy: for pricing/plans pages, show distinct plan cards or a comparison table with prices, billing cadence, recommended plan, concrete limits/features/audience differences, and plan-specific actions; no "all core features" filler.',
  '- Pricing CTAs: plan-card actions should reflect the plan or funnel step; no identical Choose plan / Get started buttons repeated across every tier.',
  '- Conversion close: for landing and marketing pages, include a final CTA/footer, FAQ, contact/demo/signup form, calendar/contact route, or next-step section near the end; no generic "Ready to get started?" close without a specific outcome, timeframe, or next deliverable.',
  '- FAQ anatomy: when using FAQ/frequently-asked-questions sections, include multiple concrete question/answer items that address real objections, pricing, migration, support, security, or setup details; no generic "what is this?" questions or "contact us" answers.',
  '- Lead form response: for contact, demo, signup, waitlist, and newsletter forms, include visible loading/submitting, success/confirmation, and error/validation feedback states.',
  '- Form field specificity: for lead, signup, demo, contact, and product forms, use field labels tied to the requested business information; no Name / Email / Message-only forms.',
  '- Feedback messages: toasts, alerts, banners, and inline confirmations should name the object, action result, or recovery step; no Success / Saved / Error-only copy.',
  '- Settings controls: toggles, checkboxes, and radio choices should name the controlled object and effect; no Option 1 / Enable / Notifications-only settings.',
  '- Card/module specificity: repeated feature, pricing, proof, project, and testimonial cards must have distinct titles, data, and outcomes; no copied card bodies.',
  '- Site footer: for landing, brand, portfolio, pricing, and marketing pages, finish with a real footer containing brand/contact details, secondary links, social/legal links, or copyright/support information; no Product / Company / Resources-only footer columns.',
  '- Section specificity: section headings should name the actual product area, workflow, audience, or outcome; avoid stacked generic headings like Features, Benefits, Testimonials, and How it works.',
  '- Workflow steps: steppers, timelines, and process flows should use domain actions or milestones; no Step 1 / Step 2 / Step 3-only labels.',
  '- Tabs and view switchers: use domain-specific view labels for app UI and dashboards; no Overview / Details / Settings-only tab sets.',
  '- Dialog titles: modals, drawers, and confirmation surfaces should name the object, action, or consequence; no Details / Confirmation-only titles.',
  '- First-screen hierarchy: include a specific top-level H1/page title, supporting copy, and a visually dominant primary action before dense secondary content.',
  '- Hero viewport composition: for landing, brand, portfolio, pricing, and marketing pages, avoid full-height heroes that hide the next section; keep a hint of the following content visible in the first viewport.',
  '- Hero/title copy: do not use prompt/meta headings like "marketing site for..." or "pricing page for..."; use the brand/product/person name or a literal offer/category as the H1.',
  '- Prototype coherence: for multi-screen work, include consistent navigation, tabs, breadcrumbs, or page-switching entry points that connect related screens; when several sibling pages exist, expose more than one sibling route instead of linking only a single page.',
  '- Content realism: use plausible domain-specific labels, data, names, prices, dates, and empty-state copy; no lorem ipsum or generic placeholder cards.',
  '- Interaction depth: include hover/focus/disabled states and small UI feedback; no dead `href="#"` links or visual-only buttons — CTAs must navigate, submit, expand, filter, toast, or otherwise visibly respond.',
  '- State coverage: represent happy path plus relevant empty/loading/error/permission/offline states for app surfaces with domain-specific state copy and recovery actions; no generic "No data" or "Something went wrong" panels.',
  '- Responsive polish: explicitly handle mobile, tablet, and desktop breakpoints with no overlap, clipped text, or tiny tap targets.',
  '- Handoff notes: when a DESIGN.md path is provided, record page role, tokens/components used, key states, responsive behavior, and implementation notes.'
]

export const PROTOTYPE_NAVIGATION_MARKUP_LINES: readonly string[] = [
  'Prototype link markup contract:',
  '- Use `<a href="...">` for navigation items that are semantically links.',
  '- For button-like, card-like, form-submit, or tab-like controls that navigate to another screen, keep the right element and set `data-href="..."` / `data-prototype-href="..."` to the listed prototype href, or `data-prototype-target="Exact Screen Title"` when only the target page title is available; the prototype player intercepts those attributes.',
  '- If a scripted router is necessary, call `history.pushState(...)` / `history.replaceState(...)` or `location.assign` / `location.replace` / `location.href` / `location.hash` with a prototype href or exact screen title; the prototype player intercepts those too.',
  '- For Back / Previous controls that should return to the last prototype screen, call `history.back()` or `history.go(-1)`; the prototype player maps that to its own screen history.',
  '- Prefer native `<a>` / `<button>` elements. If a whole card/tab must be a non-native clickable region, add `role="button"` or `role="tab"`, `tabindex="0"`, and the same `data-prototype-*` target so click and keyboard activation both work in prototype mode.',
  '- Do not rely on text-only mentions, comments, or dead `href="#"` links for cross-screen navigation.'
]
