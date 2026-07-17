# Wiring Strategy

Inter-page `interactions` express clickable cross-page controls in preview. Canvas **visible wiring** is the subset of interactions that should be drawn as page-level business flow arrows. The planning dimension of visible wiring is **business flow between pages**; auxiliary navigation such as Back, return-to-list, global navigation, breadcrumbs, and skip links should usually remain clickable but hidden from the canvas with `hideEdge: true`. This document is the **sole authoritative definition** of wiring; all wiring behavior in workflows and file-specs must comply with this document.

| Section | Description |
|------|------|
| When to Wire | Assessment criteria for whether to create wiring in each scenario |
| Visible Wiring Map + Hidden Interaction Plan | Format and principles for page-to-page business flow arrows and non-drawn clickable controls |
| `data-dom-id` Naming Convention | Naming format and usage rules for wiring anchor attributes |
| Registering Wiring in the `.design` File | **Main Agent** registers wiring in page node interactions after all Sub-Agents complete |
| Version Convergence | **Mandatory** interaction convergence when a page node carries `supersedesPageId`: redirect incoming edges to the newest version and retire the superseded page's navigation |
| `data-dom-id` Maintenance Rules | Restrictions on adding, deleting, and modifying existing wiring anchor attributes |

---

## When to Wire

| Scenario | Wire? | Notes |
|------|---------|------|
| Creating a new canvas project | [Yes] Auto-wire | Main Agent plans the visible wiring map plus hidden interaction plan and passes relevant entries to Sub-Agents |
| User explicitly requests wiring | [Yes] Wire as requested | e.g., "add the new page to the navbar", "set up page navigation" |
| Adding a new page (navigation not mentioned) | [No] Do not wire | `interactions` remains empty array `[]` |
| Exploring new style / modifying theme | [No] Do not create new wiring | Existing `interactions` remain unchanged; no new wiring is added. Theme customization only updates CSS variables and `<head>` — it does not touch page structure or navigation |
| Generating page variants | [No] Do not wire | Variants are temporary comparison options and do not represent final navigation structure |
| Fork copy UI redesign | [No] Do not wire | Original interactions preserved in copy, but no new ones added |

---

## Wiring Map

When creating a new project, the Main Agent first plans both:

1. **Visible wiring map**: the core business flow arrows that should be drawn on the canvas.
2. **Hidden interaction plan**: clickable cross-page controls that should work in Preview but should not draw canvas edges.

### Map Format

```
Wiring Map:
  Homepage → Products (cta-products)
  Products → Pricing (cta-pricing)
  Pricing → Contact Us (cta-contact)

Hidden Interaction Plan:
  Products → Homepage (back-home, hideEdge=true, reason=back)
  Homepage → Blog (cta-blog, hideEdge=true, reason=secondary shortcut)
  Page 1 → Page 3 (link-details, hideEdge=true, reason=skip link / non-primary branch)
```

### Map Principles

**Design goal**: Wiring on the canvas should present as a clear unidirectional arrow chain, letting viewers immediately understand the browsing path between pages.

| Principle | Description |
|------|------|
| **Default linear single chain** | Pages connect end-to-end in logical order, each page 1 exit, last page 0 exits. This is the default topology when first creating a project, unless the business flow itself has branches |
| **Visible wiring = business flow, hidden interactions = auxiliary navigation** | Visible wiring only expresses the user's core browsing path (business funnel). Auxiliary navigation still needs `interactions` when the control is visibly clickable, but it should normally use `hideEdge: true` |
| **Visible wiring is unidirectional and acyclic** | Visible canvas edges must remain DAG. A→B must not produce a visible B→A edge. Return controls are allowed only as hidden interactions with `hideEdge: true`, not as ordinary reverse wiring |
| [Hard limit] **Per-page exits ≤ 2** | Default is 1 (linear single chain). Only allowed to be 2 when the business flow genuinely branches. Exceeding 2 indicates navigation component links are mixed in |
| [Hard limit] **Total visible wiring count ≤ page count** | Linear single chain = page count - 1. Hidden interactions with `hideEdge: true` are not counted as visible wiring |

**Self-check**: After planning the map, verify visible edges only — no cycles, per-page visible exits ≤ 2, visible count ≤ page count. Then verify every visibly clickable cross-page control is either in the visible wiring map or in the hidden interaction plan with `hideEdge: true`. This includes Back buttons, return-to-list controls, breadcrumbs, global nav items, secondary CTAs, skip links such as Page 1 → Page 3, overlay backdrops/scrims, and floating-layer close/cancel/back controls.

---

## `data-dom-id` Naming Convention

When generating HTML, Sub-Agents add `data-dom-id` attributes to every visibly clickable control that should navigate to another page in the same project. The Main Agent decides whether each one is visible wiring or hidden interaction.

### Naming Format

| Element Position | Naming Format | Example |
|---------|---------|------|
| Navbar link | `nav-{target-page-name}` | `data-dom-id="nav-about"` |
| CTA button | `cta-{target-page-name}` | `data-dom-id="cta-pricing"` |
| Card/other link | `link-{target-page-name}` | `data-dom-id="link-portfolio"` |
| Secondary shortcut / skip link | `shortcut-{target-page-name}` or `link-{target-page-name}` | `data-dom-id="shortcut-blog"` |
| Back / return control | `back-{target-page-name}` or `back-previous` | `data-dom-id="back-products"` |

### Rules

- `{target-page-name}` uses kebab-case, consistent with the target page filename (minus `.html`)
- Only added for links pointing to **other pages within the project**; external links do not need it
- `href` attribute is uniformly set to `#` (the canvas SDK handles navigation through interactions)
- Each `data-dom-id` value must be unique within the same page; if both the navbar and page body have links to the same page, use different prefixes to distinguish (e.g., `nav-about` and `cta-about`)
- Do not use `data-dom-id` as the active-state key. Shared navigation/tab
  chrome uses `data-nav-key` / `data-tab-key` for active styling and
  `data-dom-id` only for clickable interaction registration. This lets every
  page set its active item through the `activeNavItem` / `activeTab` slot without
  changing the shared header/sidebar/tab DOM.
- Any visible cross-page control inside the project must either:
  - be listed in the visible wiring map and registered without `hideEdge`, or
  - be listed in the hidden interaction plan and registered with `hideEdge: true`.
- Global navigation components (navbar, Tab Bar, sidebar menu), breadcrumbs, secondary CTAs, and Page 1 → Page 3 skip links are usually hidden interactions: they should be clickable in preview but should not draw canvas edges.
- Back / return controls are allowed and expected on secondary/detail pages when the UI pattern calls for them. They must use `hideEdge: true`.
- Modal, drawer, popover, menu, command palette, preview panel, and other
  floating-layer states must include hidden return interactions for the
  backdrop/scrim when it is visually clickable, plus every explicit
  close/cancel/back control. These targets should point to the source/base page
  and must use `hideEdge: true`.

---

## Registering Wiring in the `.design` File

> **Wiring registration is the Main Agent's responsibility, not the Sub-Agent's.** When Sub-Agents execute in parallel, each can only see the page it is responsible for and cannot know other Sub-Agents' generated page node IDs. Therefore, having Sub-Agents register wiring would cause `targetPageId` to be missing or incorrect.

### Responsibility Division

| Role | Wiring-Related Responsibility |
|------|------------|
| **Sub-Agent** | Adds `data-dom-id` attributes in HTML for visible wiring entries and hidden interaction entries passed by Main Agent; does not register page nodes and does not write `.design` |
| **Main Agent** | After all Sub-Agents complete, reads the `.design` file and uniformly populates `interactions` arrays for each page node based on the visible wiring map and hidden interaction plan |

### Main Agent Registration Flow

After all Sub-Agents complete page generation (executed together with Step 3.5 page order rearrangement):

1. Read the `.design` file, obtain all page nodes' `id` and `title`
2. Based on the visible wiring map and hidden interaction plan, populate the `interactions` array for each source page node
3. Write back to the `.design` file
4. **Immediately re-read the `.design` file, verify item by item that every domId in the expected wiring list exists within the corresponding page node's `interactions`, and that targetPageId points to a valid node** — if any single item does not match, wiring must not be declared complete; must rewrite and re-verify.

```json
{
  "interactions": [
    { "domId": "nav-about", "targetPageId": "page-about-us", "transitionLabel": "Learn more" },
    { "domId": "cta-pricing", "targetPageId": "page-pricing", "transitionLabel": "See pricing" },
    { "domId": "shortcut-blog", "targetPageId": "page-blog", "hideEdge": true, "transitionLabel": "Read blog" },
    { "domId": "back-home", "targetPageId": "page-home", "hideEdge": true, "transitionLabel": "返回" }
  ]
}
```

- Each `domId` corresponds to a `data-dom-id` attribute value in the HTML
- `targetPageId` points to the target page node ID within the same group
- `hideEdge: true` means the interaction remains clickable in preview but does not draw a canvas edge. Use it for Back / return / close-to-list controls, global navigation links, breadcrumbs, secondary CTAs, skip links, overlay backdrops/scrims, floating-layer close/cancel/back controls, or any non-primary cross-page navigation that would clutter the canvas.
- [FORBIDDEN] Do not model return ability with a normal reverse interaction. If the target is a previous page, parent list, or source page, `hideEdge` must be `true`.
- `transitionLabel` is optional; describes the transition logic (e.g., "login success"). All interactions from the same source to the same target share the same label
- When both the visible wiring map and hidden interaction plan are empty, `interactions` remains empty array `[]`

---

## Version Convergence

When a comparison page **replaces** an existing page (the new page node carries `devMetadata.supersedesPageId`), the project must not leave a mixed-version navigation graph where the new-version flow can reach the retired old version in preview. This section is **mandatory** and overrides the "do not wire when adding pages" default in "When to Wire".

**Trigger**: Any page node written with `supersedesPageId` (e.g., Quick Path A0/A1 comparison pages that replace their source page, or Adopt Variant/Draft replacements). The Main Agent must perform convergence in the same round that writes the new node's wiring back to `.design`.

**Convergence procedure** (Main Agent, single pass):

1. **Redirect incoming edges**: Scan all page nodes' `interactions`; every entry whose `targetPageId` equals a superseded page id must be rewritten to point to the superseding page id. Keep `hideEdge` and `transitionLabel` unchanged.
2. **Retire outgoing edges**: Set the superseded page node's own `interactions` to empty array `[]`. The retired page stays on the canvas as a static comparison artifact; it must not navigate anywhere in preview.
3. **Chain convergence**: If the superseded page itself supersedes an earlier version (v3 → v2 → v1), walk the `supersedesPageId` chain and apply steps 1–2 to every superseded ancestor. All redirects target the **newest** version at the end of the chain.

**Self-check (blocking)**: After writing back, re-read `.design` and verify: (a) no page node's `interactions` contains a `targetPageId` referencing any superseded page; (b) every superseded page node's `interactions` is `[]`. Equivalently, a BFS from every non-superseded entry page must not reach any superseded page. If either check fails, fix and re-verify before declaring completion. The validation script (`validate-design-file.mjs` check 18) enforces the same invariants as a blocking error.

**Topology notes**: Convergence never adds visible edges — redirects inherit the original entry's `hideEdge` value, so the "visible count ≤ page count / per-page exits ≤ 2" hard limits are unaffected.

**When NOT to set `supersedesPageId`**: If the user explicitly asks to keep both versions usable in preview ("两版都保留", "keep both versions clickable"), do not write the field; no convergence happens and both navigation chains remain intact.

---

## `data-dom-id` Maintenance Rules

The `data-dom-id` attributes already present on HTML elements are business-critical fields for the runtime parser:

- [FORBIDDEN] **Must not delete**: Even if the Agent believes there are too many wires or they can be "optimized", it is **absolutely forbidden** to remove any existing `data-dom-id` and corresponding interaction, unless the **user explicitly requests** removal
- [FORBIDDEN] **Must not edit**: Must not modify existing `data-dom-id` values or move them to other elements
- [Yes] **May add**: New elements may add new `data-dom-id` when they are part of the visible wiring map or hidden interaction plan (must comply with naming convention)

### Version Convergence Exception

When executing Version Convergence (see "Version Convergence" section above), the Main Agent is **allowed and required** to:

- Modify existing interaction entries' `targetPageId` so they point to the newest superseding page
- Clear the superseded page node's `interactions` to `[]`

This exception applies **only to the `.design` interactions registry**. The `data-dom-id` attributes in HTML files remain fully covered by the "must not delete / must not edit" rules above — convergence never touches HTML.

### Redesign Scenario Exception

When restructuring HTML structure on a **Fork copy** via the `redesign-ui.md` workflow, the above "must not delete/edit" rules may be relaxed:

- If page structure restructuring causes the HTML element carrying `data-dom-id` to be removed or restructured, **it is allowed** to delete or migrate `data-dom-id` in the copy
- But the copy's `.design` file `interactions` must be simultaneously updated — remove invalidated wiring entries, or keep interactions unchanged after migrating `data-dom-id` to the new element
- This exception **only applies to Fork copies**; the original project's `data-dom-id` remains under the "absolutely forbidden to delete" constraint
