# Generate Page Variants

When the user requests "try a different approach", "try another layout", "generate some variants to compare", "are there other possibilities for this page" for a page in an existing design project, use this workflow.

> **Core Principle: Only generate layout variants for the specified page without affecting other parts of the project.** The variant workflow only generates alternative proposals for one (or a few) pages specified by the user. Each variant is added to the canvas as an independent page. **No new themes are added, no other pages are copied, no existing content is deleted or modified.**
>
> [FORBIDDEN] The following operations are **absolutely forbidden** in the variant workflow:
> - Creating a new brand CSS file or modifying existing themes
> - Copying pages the user did not specify
> - Deleting or modifying any existing pages or nodes
> - Establishing navigation wiring for variant pages
>
> **Theme selection priority for variants** (from highest to lowest):
> 1. **Theme bound to the user's selected page** — When the user explicitly selects a page for variant generation, use the brand CSS file currently bound to that page
> 2. **User's currently selected Design Library / theme** — When context contains `user selected design library` or the user explicitly specified a theme preference in conversation, use that theme (following `../operation-policies/design-library-parsing.md` "Theme Source Priority")
> 3. **Theme used when the original page was first created (fallback)** — When none of the above sources exist, fall back to the original page's theme
>
> **Key Distinction from "Customize Theme"**: Customize theme (`customize-theme.md`) updates the brand CSS and re-applies to all existing pages in-place; explore variants (this workflow) only generates layout/structure alternatives for a specified page. The theme is determined by the priority above, and this workflow itself does not create a new brand CSS file.
>
> **Wiring Rule**: Variant pages do not actively establish wiring. See `operation-policies/wiring-strategy.md` for details.

---

## Multi-Style Existing Project Path (Free Explore Mode Only)

Use this path only when the user explicitly asks for different visual styles for an existing project, not merely different layouts.

Differences from the default variant workflow:

| Dimension | Rule |
|-----------|------|
| Brand CSS | Temporary `colors_and_type-variant-{N}.css` files are allowed for comparison variants |
| Original pages | Original HTML, CSS, nodes, and interactions must not be modified or deleted |
| Canvas organization | Each style direction uses a separate comparison group so the user can compare rows visually |
| Theme nodes | Do not create theme nodes or `.theme` files; style comparison is CSS-only |
| Adoption | If the user later chooses a style, route to `edit-project.md` Adopt Variant/Draft Path |

All multi-style variants must still satisfy the Differentiation Mandate below. Reskinning the same layout with different colors is forbidden.

---

## Differentiation Mandate (Free Explore Mode — Critical)

> **This section applies when `operatingMode: 'free-explore'` (no Design Library). In Library-Bound Mode, variants must stay within Library constraints but still differ meaningfully in layout/composition.**

When the user requests multiple style/layout variants, the variants **must be fundamentally, structurally different** — not superficial variations of the same approach.

### [FORBIDDEN] Reskinning Anti-Pattern

The following "reskin" behaviors constitute a quality failure and are absolutely forbidden:

| Anti-Pattern | Why It Fails |
|-------------|--------------|
| Same section arrangement + different color palette | User sees 3 identical pages with different paint jobs |
| Same grid system + different font pairing | Structural sameness makes variants indistinguishable at a glance |
| Same Hero composition + different hero image | The "variant" is just an image swap, not a design exploration |
| Only changing border-radius / shadow / spacing values | These are parameter tweaks, not design alternatives |
| Same information hierarchy with different visual weight distribution | Results feel like the same page at different zoom levels |

### [REQUIRED] Minimum Differentiation Standard

Each variant must differ from every other variant (and from the original) in **at least 2** of the following 6 dimensions:

| Dimension | Contrast Examples |
|-----------|------------------|
| **Compositional Strategy** | Symmetrical centered vs. asymmetric offset; full-bleed immersive vs. contained boxed; single-column editorial vs. multi-column dashboard |
| **Spatial Rhythm** | Dense high-information-density vs. generous whitespace breathing room; uniform grid spacing vs. alternating tight/loose rhythm |
| **Visual Hierarchy** | Typography-dominant (large headlines, minimal imagery) vs. image-dominant (full-bleed photos, minimal text) vs. interaction-dominant (cards, toggles, explorable UI) |
| **Narrative Structure** | Linear scroll storytelling vs. modular grid jumping vs. full-screen paginated sections vs. progressive disclosure (accordion/tabs) |
| **Component Morphology** | Card grid vs. list stream vs. gallery masonry vs. timeline vs. kanban columns vs. magazine layout |
| **Design Language** | Minimal restraint (clean lines, muted palette, ample negative space) vs. expressive maximalism (bold colors, layered textures, dynamic angles) vs. organic/handcrafted (rounded blobs, hand-drawn elements, warm earth tones) vs. geometric/engineering (hard edges, monospace type, technical grid) |

### Contrast Matrix (Main Agent must fill before dispatch)

Before dispatching variant Sub-Agents, the Main Agent must internally construct a **Contrast Matrix** to verify sufficient differentiation exists between proposals:

```
Contrast Matrix (example for 3 variants):
                    | Variant A         | Variant B         | Variant C
Compositional       | Full-bleed immersive | Card grid contained | Asymmetric editorial
Spatial Rhythm      | Generous whitespace  | Dense, compact      | Alternating rhythm
Visual Hierarchy    | Image-dominant       | Interaction-dominant | Typography-dominant
Narrative Structure | Full-screen pages    | Modular grid        | Linear scroll
Component Morphology| Gallery masonry     | Dashboard cards     | Magazine columns
Design Language     | Minimal restraint   | Geometric engineering| Organic handcrafted
```

**Validation rule**: Any two columns must differ in ≥ 2 rows. If they don't, revise the proposal plan before dispatch.

> **This matrix is for internal planning only** — it is [FORBIDDEN] to expose it in user-visible output (see `operation-policies/user-facing-language.md`). Present variants to users with simple, evocative names and one-sentence descriptions.

| Section | Description | User-facing Title |
|---------|-------------|-------------------|
| [Applicable Scenarios](#applicable-scenarios) | Determine when the variant generation workflow should be used | — |
| [Step 1 — Understand Exploration Direction](#step-1--understand-exploration-direction-main-agent) | Read existing design files and confirm variant direction with user | Confirming exploration direction |
| [Step 2 — Plan Variant Proposals](#step-2--plan-variant-proposals-main-agent) | Plan 2–3 differentiated variant proposals for user confirmation | Planning alternative proposals |
| [Step 3 — Determine Source Group](#step-3--determine-source-group-main-agent) | Determine the source theme group for variant pages | (Silent background, not displayed) |
| [Step 4 — Generate Variant Pages](#step-4--generate-variant-pages--dispatch-sub-tasks-parallelizable) | Main Agent pre-registers variant nodes, then dispatches sub-tasks in parallel to generate variant HTML | Generating alternative proposals |
| [Step 5 — Blocking Validation](#step-5--one-pass-complete-validation-main-agent-blocking--must-not-skip) | Execute blocking validation script after all variants complete | (Silent background, not displayed) |
| [Step 6 — Guide Preview](#step-6--guide-preview-main-agent) | Output variant comparison table and guide user to view in canvas | Done, ready for comparison preview |

> **User-facing Title**: When the Agent displays this step in TodoList or progress messages, it **must use the expression from this column**. Using the internal section names on the left is [FORBIDDEN]. Full rules in `operation-policies/user-facing-language.md` "Language Constraints for Task Planning and Progress Display".

## Applicable Scenarios

| User Intent | Use This Workflow |
|-------------|-------------------|
| "Try a different layout for comparison" / "Try another arrangement" | Yes |
| "Are there other style directions for this page" / "Give me some variants" | Yes |
| "I want to see different approaches for the homepage" / "Explore other possibilities" | Yes |
| Only changing colors/fonts (no layout structure changes) | No → Use `customize-theme.md` |
| Tweak UI / Redesign UI | No → Use `redesign-ui.md` |
| Create entirely new project from scratch | No → Use `create-project.md` |

## Step 1 — Understand Exploration Direction (Main Agent)

1. Determine target `.design` project path (see `operation-policies/decision-rules.md` "Pre-execution Preparation")
2. Read existing `.design` file — get all nodes and group distribution
3. Read target page's HTML — understand current page structure, content, and style
4. **Determine the theme for variants** (from highest to lowest priority):
   - If user selected a page → find the brand CSS file corresponding to the group of that page node, use that theme
   - If context contains `user selected design library` → use that Library's theme per `../operation-policies/design-library-parsing.md` "Theme Source Priority"
   - Otherwise → use the brand CSS file corresponding to the original page's group (fallback)
5. Read the determined brand CSS file — get design constraints
6. Determine the baseline page for variants: the user-specified page, or all pages under that theme
7. Use **AskUserQuestion** to confirm exploration direction with user:

```
Recommended phrasing:
"What direction would you like to explore for variants?"

Option examples (dynamically generated based on baseline page characteristics):
- Layout restructuring: Keep content unchanged, try a completely different page structure and section arrangement
- Style pivot: On the current layout, switch to a different visual style (e.g., from minimalist to expressive design)
- Information density adjustment: Increase or decrease page information density, explore more compact or more spacious presentation
- Narrative reorganization: Reorganize content storytelling order and hierarchy, change the user's reading experience
```

> Options should be generated based on the baseline page's actual content and current style — the above are examples only. The goal is to help the user clarify the exploration direction, not to have users describe it themselves.

## Step 2 — Plan Variant Proposals (Main Agent)

Based on the user's selected direction, plan 2–3 differentiated variant proposals (consistent with SKILL.md "2~3 schemes"). Each proposal must specify:

- **Variant name**: Brief description (e.g., "Wide narrative version", "Card grid version")
- **Core differentiators**: Key differences from original (layout structure, visual style, information organization, etc.)
- **Preserved elements**: Content inherited from original (copy, images, brand elements)

Present the proposal plan overview to the user; proceed to generation phase after confirmation.

## Step 3 — Determine Source Group (Main Agent)

Variant pages reuse the same `group` as the source page. Groups organize pages in rows on the canvas — creating a new group for variants would produce an isolated row with no relation to the original.

1. Read the target source page node in current `.design`
2. Determine `sourceGroup`:
   - If `sourcePage.canvasData.group` is a non-negative integer → use it
   - If undefined / null / empty string / non-number → use `0`
3. Append all variant page nodes with `canvasData.group = sourceGroup`
4. `canvasData.group` must be a JSON number; strings such as `"default"` are forbidden and will fail `.design` validation.

## Step 4 — Generate Variant Pages → Dispatch sub-tasks (parallelizable)

> **Image Pre-generation**: If variants require new images (e.g., exploring different visual compositions), the Main Agent must first dispatch image generation sub-tasks in parallel (same as `create-project.md` Step 2.5). All images must complete before dispatching variant page generation sub-tasks. Variant Sub-Agents are [FORBIDDEN] from calling image generation tools themselves — they can only reference existing images in `assets/`.

### 4.1 — Main Agent Pre-registers Variant Nodes (before dispatching Sub-Agents)

The Main Agent must append all variant page skeleton nodes to the `.design` file **before** dispatching Sub-Agents. This ensures:
1. No concurrent write race conditions on `.design`
2. Canvas visibility is guaranteed even if a Sub-Agent fails

For each variant, append a node entry (fields consistent with the Page Node template in `design-file-structure.md`):
```jsonc
{
  "id": "page-{slug}",  // e.g., page-index-variant-1
  "type": "page",
  "title": "{original page title} — {variant name}",
  "version": 1,
  "createdAt": 1712476800000,  // current timestamp (ms)
  "devMetadata": {
    "htmlSrc": "pages/{variant-page-name}.html",
    "interactions": []  // variants do not establish wiring
  },
  "canvasData": { "x": 0, "y": 0, "group": 0 }  // x/y = 0 (autoLayout); replace 0 with numeric sourceGroup
}
```

### 4.2 — Dispatch Sub-Agent Tasks (parallelizable)

Dispatch an independent sub-task for each variant proposal (parallelizable). Each Sub-Agent is **only responsible** for generating the variant HTML page. **[FORBIDDEN]** Sub-Agents writing to or modifying the `.design` file — nodes are already pre-registered by the Main Agent in Step 4.1.

> **Sub-Agent failure handling**: See `page-generation-template.md` "Sub-Agent Failure Fallback (Universal)" for retry and skip policy. For variants, if retry fails, skip that variant **and the Main Agent must remove the pre-registered skeleton node (Step 4.1) for that variant from the `.design` `data` array** — otherwise the orphan node's `htmlSrc` points to a non-existent file and validation/canvas rendering will fail (Core Invariant #4). Then reduce `--expected-pages` in validation accordingly.

Sub-tasks are based on shared template `{SKILL_DIR}/workflows/page-generation-template.md`. All shared dispatch fields are assembled per `operation-policies/dispatch-schema.md`. Only **variant-specific differentiated parameters** are listed below:

```
Task: Generate page variant "{variant name}" (based on "{original page title}")
Output:
  - {designProjectPath}/pages/{variant-page-name}.html
Shared template: {SKILL_DIR}/workflows/page-generation-template.md (pre-steps, constraint files, shared rules all in this file)
All shared dispatch fields: assemble per {SKILL_DIR}/operation-policies/dispatch-schema.md, populated with this project's concrete values
Differentiated input (variant-specific):
  - Brand CSS path: {cssFilePath} (theme determined by Step 1 priority)
  - Original page content: {read HTML — embedded completely, as reference baseline for variant design}
  - Variant proposal:
    - Name: {variant name}
    - Exploration direction: {user's selected direction}
    - Core differentiators: {key differences from original}
    - Preserved elements: {content inherited from original}
Additional notes (variant-specific rules):
  - Variants are redesign explorations based on the original page, not simple copies. Must produce **meaningful differences** in the specified exploration direction.
  - **[CRITICAL — Free Explore Mode]** Variants MUST satisfy the "Differentiation Mandate" section above: differ from original AND from each other in ≥ 2 of the 6 dimensions (Compositional Strategy, Spatial Rhythm, Visual Hierarchy, Narrative Structure, Component Morphology, Design Language). Superficial "reskinning" (same structure + different colors/fonts) is a quality failure.
  - The original page's textual content and business information should be preserved, but presentation can be reorganized.
  - Image assets reuse resources from the original project's assets/ directory. [FORBIDDEN] to call image generation tools yourself — all new images must be generated by the Main Agent via image pre-generation sub-tasks before Step 4 begins.
  - [FORBIDDEN] **Do not add any `data-dom-id`; `interactions` must remain empty array `[]`.** Variants are temporary comparison proposals and do not represent final navigation structure.
  - Variant naming rule: {original-page-name}-variant-{N}.html (e.g., index-variant-1.html, index-variant-2.html)
```

## Step 5 — One-pass Complete Validation (Main Agent, Blocking — must not skip)

> **This step is blocking. After all Sub-Agents complete and before guiding the user to preview, the Main Agent must personally execute this validation. [FORBIDDEN] to proceed to Step 6 without passing validation.**

Use `scan-design-directory.mjs` for one-pass complete validation, avoiding multiple tool calls:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-project-path> --expected-pages=<N>
```

Where `<design-project-path>` is the design project root directory path, and `<N>` is the original page count + number of variants generated.

When exit code is 1, follow the repair procedure in `operation-policies/design-project-validation.md`.

## Step 6 — Guide Preview (Main Agent)

Inform the user that variants have been generated and guide them to view and compare next to the source design row in the canvas. If the user prefers to preview HTML directly in a browser, a local HTTP service can also be started (see `operation-policies/output-delivery.md` "Preview Method" section).

**Finish summary must not include manual links**, format specified in `operation-policies/output-delivery.md` "Artifact Declaration" section.

### Variant Comparison Table

Output a Markdown table to the user, providing an overview of differences between the original and each variant:

| Proposal | File | Core Characteristics | Differences from Original |
|----------|------|---------------------|--------------------------|
| Original | `pages/index.html` | Classic layered layout, Hero + features section + CTA | — |
| Variant 1: Wide narrative version | `pages/index-variant-1.html` | Full-width immersive narrative, scroll-driven content reveal | Layout changed from sectioned blocks to continuous narrative flow |
| Variant 2: Card grid version | `pages/index-variant-2.html` | Modular grid layout, higher information density | Changed from vertical flow to grid-based organization |

- **Proposal**: Proposal identifier (Original / variant name)
- **File**: File path relative to project root
- **Core Characteristics**: Layout and visual features of this proposal
- **Differences from Original**: Key difference points from the original page

> Remind the user: If a variant proposal is satisfactory, they can request to replace it as the official version, or further refine on this basis.
