# Figma Token Generation Sub-Task Template

> ⚠️ ROUTE: Figma (EXTRACT ONLY). Rules from scratch-token-gen do NOT apply here.

> Sub-agent reads design-tokens.jsonl (which includes merged design language overview) to generate complete design token CSS.
> Writes 1 file. Writes compact report to `ReturnReportFileAbs` (≤ 4KB).
> Main Agent runs `css-to-json.mjs` after this sub-agent returns.

---

## Sub-Agent Execution Constraints

- Tool bans: per SKILL.md invariant #16 (`TodoWrite`, `Skill`, `Grep`, `RunCommand`, `SearchCodebase`); this template additionally forbids `LS`, `Glob` (no discovery needed — all input paths are explicit).
- The variables-raw data may be split across multiple part files (e.g. variables-raw.md, variables-raw-part1.md ... part7.md) — read ALL parts to ensure complete coverage.
- SILENT: Do NOT output intermediate reasoning between tool calls. After Write, write the report file and final-respond only `已完成 Token 生成。`.
- WRITE-FIRST (anti-overthinking): Do NOT compose the complete token structure in your
  reasoning before writing. After the READ SEQUENCE, go STRAIGHT to the Write call and
  think WHILE writing — the CSS file itself is your working draft. Correctness is
  enforced by the read-back REVIEW step afterwards, not by upfront mental rehearsal.
  Pre-drafting the full CSS in reasoning wastes tokens and adds no accuracy.
- COMPLETION CAP: per SKILL.md invariant #23. Machine data goes to `ReturnReportFileAbs`; final response is only `已完成 Token 生成。`.
- ⚠️ DISPATCH PARAMETER: `subagent_type` MUST be `"general_purpose_task"` (not "Explore", not "search"). Sub-agents WRITE files to disk.

---

## Task Template

```
Task: Generate complete token system from Figma design data for brand "{brandName}" ({productType}).
Output (write 1 file):
  1. {output_dir}/colors_and_type.css

⛔ HARD PROHIBITION — You MUST write EXACTLY 1 file: {output_dir}/colors_and_type.css
css.json is derived by deterministic scripts from your CSS output.
Writing it yourself will produce INCORRECT format and break the frontend
(TypeError: Cannot read properties of undefined (reading 'hex')).
Do NOT write css.json. ONE file only.

⛔ NO CSS IN REASONING (HARD — this is a budget rule, same severity as the file prohibition above):
NEVER draft, rehearse, or revise CSS content inside your thinking/reasoning.
Any CSS composed in reasoning must be typed AGAIN in the Write call — it is 100% wasted
tokens and adds zero accuracy. Concretely:
  - After the READ SEQUENCE, your reasoning before Write is limited to SHORT decisions
    (theme mode, group list, priority order) — never token-by-token content.
  - The FIRST place any `--token: value;` line appears MUST be the Write tool call.
    Compose the CSS inside the Write argument, deciding values as you type.
  - If during REVIEW you find problems, fix them with Edit calls on the FILE.
    Do NOT re-plan or re-draft the corrected CSS in reasoning and rewrite the whole file.
All token categories with source data MUST be present (colors, spacing, radius, shadow, typography).

NOTE: The output contract (group comments, ordering, @primary, @group-priority, category
naming, aliases, self-review) is the route-independent css-tokens.md § Shared Token
Contract — this route is its reference standard. Rules below spell it out together with
this route's Figma-specific source-fidelity requirements.

⚠️ HARD RULES (embedded — do NOT skip):

  READ SEQUENCE (mandatory, in this order):
  R1. Read constraint specs FIRST: {SKILL_DIR}/file-specs/css-tokens.md
  R2. Read design tokens: {tmp_dir}/design-tokens.jsonl (JSONL format — each line is a JSON object with `_type` field; line 0 is meta describing all available sections including designLanguage).
      — First: attempt to read the full file (no offset/limit).
      — If Read returns "exceeds the limit of 64KB" error: this is a large token file. Re-read in chunks using offset/limit. Since JSONL has few lines (typically 10-20, one per variable set), use small limits:
        Read offset=1 limit=5 → Read offset=6 limit=5 → Read offset=11 limit=5 → ... until no more content.
        Accumulate ALL `_type` sections across chunks. Do NOT start writing CSS until every line has been consumed.
      — Edge case: if even a single line (limit=1) exceeds 64KB, extract what you can and note missing data in warnings.
  R2b. Read raw Figma variables: {bundle_path}/context/variables-raw*.md (CRITICAL for color completeness)
       — This file contains ALL Figma variables with their original designer-defined names and values.
       — design-tokens.jsonl only includes variables with numeric suffixes (e.g. /500, -6) in stepsMap.
       — Variables with semantic names (e.g. brand/hover, text/secondary, fill/active) are MISSING from design-tokens.jsonl.
       — When generating theme color tokens, cross-reference variables-raw to ensure NO semantic colors are lost.
       — If a color exists in variables-raw but not in design-tokens.jsonl variableSets, you MUST still include it.
       — ⚠️ Data may be split across multiple files: variables-raw.md (header), variables-raw-part1.md, part2.md, ... up to part7.md. Read ALL parts.
       — ⚠️ PALETTE COMPLETENESS MANDATE (CRITICAL):
         After reading all variables-raw parts, actively identify ALL distinct
         color palette families (hue scales with ≥ 2 stops). Compare against
         what design-tokens.jsonl already captured. For EACH palette family in
         variables-raw that is MISSING or INCOMPLETE in design-tokens.jsonl,
         extract it and include it in your CSS output.
         Common signs of missed palettes:
           - Variable paths like "颜色/碧涛青/*" or "Color/Cyan/*"
           - Collection names containing hue words in any language
           - Sets with ≥ 3 color variables sharing a common path prefix
         Do NOT rely solely on design-tokens.jsonl for color completeness.
         variables-raw IS the authoritative complete source.
  R3. (Optional) Read designer notes summary: {bundle_path}/generated/annotations-summary.jsonl first (only if design-tokens.jsonl designerNotes is empty or insufficient). Fallback to {bundle_path}/annotations/index.md only if the summary is missing or insufficient

  CSS GENERATION RULES:
  4. CSS blocks depend on your theme decision (see Rule 4b below). Include @import for Google Fonts, all token scales.
  4b. THEME DECISION (YOUR responsibility — not pre-determined):
     Read `themeSignals` in design-tokens.jsonl:
     - `modeComparison.identicalRatio`: ratio of variables whose light/dark values are identical
     - `luminanceProfile.darkValueRatio`: ratio of color values with luminance < 0.3
     - `sampleIdentical` / `sampleDifferent`: concrete examples

     Decision logic:
     - identicalRatio > 0.9 AND darkValueRatio > 0.8 → @dark-only
       → :root contains dark values directly. Omit .dark {} block. Add /* @dark-only */ at top.
     - identicalRatio > 0.9 AND darkValueRatio < 0.2 → @light-only
       → :root contains light values directly. Omit .dark {} block. Add /* @light-only */ at top.
     - Otherwise → dual-theme
       → :root (light values) + .dark {} (dark overrides)

     These signals are ADVISORY. You have final say — factor in designerNotes,
     specAnnotations, and overall color context.
  4c. DESIGN LANGUAGE CONTEXT (from `_type: "designLanguage"` line in design-tokens.jsonl — informs but does NOT override source data):
     The designLanguage line provides high-level design language signals to guide your decisions:
     - `style` ("flat"/"material"/"neumorphic"/etc.) — informs shadow depth, border usage
     - `density` ("compact"/"normal"/"spacious") — validates spacing choices
     - `mood` — emotional direction (e.g., "professional", "playful")
     - `brand.hasDarkMode` — quick confirmation for Rule 4b dark mode decision
     - `contrastIssues[]` — accessibility warnings; if present, add CSS comment noting
       low-contrast pairs for downstream review
     - `namingConvention` — cross-validate naming style choices

     These signals are ADVISORY context. The other lines in design-tokens.jsonl (themeSignals,
     colors, typography, etc.) remain the authoritative source for all token VALUES.
     designLanguage helps you make better decisions about organization, naming, and theme structure.
  5. SOURCE FIDELITY (applies to all Figma-route output):
     Goal: output ONLY what exists in source data.
     - Every hex value must trace to design-tokens.jsonl (Variables, resolvedSemanticColors, or scaleGroups).
     - Scales: if source has N stops, output N stops. Never fill to 10.
     - Missing roles: omit (output nothing), never fabricate.
     - Provenance: `/* Variable: {name} */` for semantic Variables; `/* Source: {set name} */` for scale groups.
  6. NO INTERPOLATION: If source data has only one color shade (e.g., primary-500), output ONLY
     that single value. Do NOT generate a full scale by lightening/darkening. Output exactly what
     exists in the source — never fabricate colors that the designer did not provide.
  7. Color Data Navigation:
     design-tokens.jsonl `colors.variableSets` is an array of Variable Sets from Figma.
     Each Set has:
       - `name`: the Figma Variable Set name
       - `isSemantic`: true if >50% variables have semantic paths (bg/, text/, border/, etc.)
       - `variables` (for semantic Sets): compact variable list, each entry is one of:
         - `{ name, light, dark }` — dual-theme variable
         - `{ name, value }` — same value in both themes or single-mode variable
         - `light`/`dark` are normalized semantic labels; original Figma modes may be non-standard names such as Day/Night
       - `scaleGroups` (for primitive Sets): color scale summaries with prefix + sample value

     ⚠️ VARIABLE-FIRST PRIORITY (CRITICAL):
     Figma Variables represent the designer's INTENTIONAL token system. When semantic
     Variable Sets exist (isSemantic=true), they are the PRIMARY source for theme tokens:

     Priority order (highest → lowest):
       P0. `authoritativePrimary` (Rule 7.2) — if present, skip all other primary logic
       P1. Semantic Variables (`isSemantic=true`, has `variables[]` with `{name, light, dark}`)
           — These ARE the designer's token definitions. Use their names for CSS variable
             naming and their light/dark values directly for :root / .dark blocks.
           — Variable name paths define roles: `bg/color-bg-1` → background token,
             `text/color-text-1` → foreground token, `Brand Color/常规 @primary-6` → primary
           — When a variable name contains `@token-name` (e.g., `@primary-6`, `@color-bg-1`),
             that suffix IS the canonical token reference. Preserve it in CSS comments.
       P2. `resolvedSemanticColors` with `confidence >= 0.7` — computed semantic mappings
       P3. Primitive scale groups (`scaleGroups` with `stepsMap`) — raw color palettes
       P4. `fromVisualAnnotations` — last resort, visual layer only
       P5. Never invent values that don't exist in any source

     When P1 (semantic Variables) and P2 (resolvedSemanticColors) conflict:
       - For the SAME role: prefer P1 if the Variable has an explicit semantic path
         (e.g., `bg/color-bg-1` for background is more reliable than a computed
         `bg.default` with confidence 0.5-0.7)
       - For PRIMARY color: P0 > P1 Variables with `brand`/`primary` in path > P2
       - `resolvedSemanticColors` with confidence < 0.7 CANNOT override an explicit
         semantic Variable. It may only create derived variables marked `/* Derived */`.

     DARK MODE FROM VARIABLES:
     When semantic Variables have `{ name, light, dark }` entries:
       - Use `light` value in `:root {}` block
       - Use `dark` value in `.dark {}` block
       - This is MORE authoritative than inferring dark values from scale inversion
         or separate "Dark/*" primitive sets
       - Variables with `{ name, value }` (single value) use the same value in both themes

     Role mapping from Variable name paths (ALIAS LAYER ONLY — applies only when
     generating Layer 2/3 portable aliases; source definition-layer token names are NEVER renamed):
       - `bg/*` or `background/*` or `Background/*` → --background, --color-bg-* aliases
       - `text/*` or `Text/*` → --foreground, --color-text-* aliases
       - `fill/*` or `Fill/*` → --color-fill-* aliases (surface/container tokens)
       - `border/*` or `line/*` → --border, --color-border-* aliases
       - `brand/*` or `Brand Color/*` or `primary/*` → --primary scale aliases
       - `status/*` or `danger/*` / `success/*` / `warning/*` → semantic status aliases
       - `interactive/*` or `action/*` → --color-link, --color-focus aliases (NOT --primary)
     ⚠️ These mappings produce ALIASES (var(--source-token)) only. The original token
     declarations MUST keep their source names verbatim — never translate or rename them.

     CSS COMMENT PROVENANCE for Variables:
       - When a token value comes from a Figma Variable, add:
         `/* Variable: {variable.name} */` (e.g., `/* Variable: bg/color-bg-1 */`)
       - When a variable name contains `@ref` suffix, note it:
         `/* Variable: Brand Color/常规 @primary-6 */`

     RESOLVED SEMANTIC COLORS (P2 — supplementary, NOT primary):
     If `resolvedSemanticColors` exists, use it to SUPPLEMENT Variable-derived tokens:
     - For roles NOT already covered by semantic Variables, use resolved entries
       with confidence >= 0.7 for core aliases: --primary, --primary-foreground,
       --background, --foreground, --border, --ring, --color-primary,
       --color-surface, --color-border.
     - `confidence < 0.7` cannot drive Layer 2 core aliases; it may only create
       optional derived variables marked `/* Derived */`.
     - If `themeSignals.quality.status` is `fail`, continue in degraded-token mode.
       Use semantic Variables first, then available resolved semantic colors,
       then primitive/spec annotation fallbacks. Mark unresolved critical roles in warnings;
       do not stop token generation only because semantic coverage is incomplete.
     - Role hints (for entries NOT overridden by P1 Variables):
       `brand.primary` → --primary / --color-primary;
       `bg.default` → --background / --color-surface;
       `text.default` → --foreground;
       `border.default` → --border / --color-border;
       `bg.brand`, `text.brand`, `icon.brand`, `border.brand` are exact brand
       semantic slots and must not be overwritten by status/primary.

     Fallback mapping strategy (P3/P4 — when Variables and resolvedSemanticColors are absent or incomplete):
     a. Start with semantic Sets (isSemantic=true) — these contain your bg, text, border, status tokens.
        Use variable name paths to identify CSS roles:
        - `bg/*` or `background/*` → --color-bg-* variables
        - `text/*` or `foreground/*` → --color-text-* variables
        - `border/*` or `outline/*` → --color-border-* variables
        - `brand/*` or `primary/*` → --primary scale
        - `status/*` → success/warning/error semantic colors
        - `interactive/*` or `action/*` → --color-link, --color-focus (NOT --primary)
     b. fromVisualAnnotations: Use description + name to identify role. If description is present, it is authoritative. If brandHints has no primaryScale/primarySample, use names like Primary/* or Brand/* as primary fallback. Convert 8-digit hex (#rrggbbaa) to rgba(r,g,b,a).
     c. themeSignals.unresolvedSummary: Note unresolved count/bySet/sample names — do not invent values for unresolved tokens
     d. For primitive color scales: if `scaleGroups[].stepsMap` exists, use exact values from `stepsMap`; otherwise output ONLY the `sample500` value as a single token. Do NOT generate additional scale stops from a single sample. If a repeated scale has `seeSet`, reuse the referenced Set scale.
  7.1 Brand Primary Color Identification (CRITICAL — overrides colorPalette.primary hint):
     When determining which color is the TRUE brand primary from colors.variableSets:
     a. AUTHORITATIVE brand signals (highest priority):
        - Variables with path containing `bg/brand`, `bg-brand`, `background-brand` → brand fill
        - Variables with path containing `text/brand`, `text-brand` → brand text
        - Variable SCALE named `brand/{hue}/*` (e.g., brand/green/600) → brand hue scale
        If these exist with a saturated chromatic color (saturation > 45%), that IS the brand primary.
     b. INTERACTIVE/STATE signals (NOT brand identity):
        - Variables in `status/primary-*`, `interactive/primary-*`, `action/primary-*` paths
          are UI interaction colors (links, focus rings, selected states) — use for --color-link or
          interactive semantic slots, NOT for --primary brand identity.
     c. FALLBACK: If no explicit brand signals exist, then `*/primary-default` or `*/primary/500` may serve as primary.
     d. Resolution: If colorPalette.primaryHint from brand-input.jsonl conflicts with (a) signals,
        always prefer (a). Add CSS comment: /* brand identity from bg-brand variable */
     e. The `status/primary-*` colors should map to semantic slots like:
        --color-link, --color-interactive, --color-focus (NOT --primary)
     f. SCALE CONFLICT RESOLUTION (when multiple Sets have same-named scales with different hex values):
        - Resolution priority:
          1. Prefer the Variable Set marked `isSemantic: true`
          2. If multiple semantic Sets exist, prefer the one whose name suggests a design system
             (e.g., 'Semantic', 'Theme', 'Token') or that contains bg-brand/text-brand variables
          3. If neither Set has semantic tokens, prefer the one whose 500-step matches
             `themeSignals.brandHints.primaryScale` or `themeSignals.brandHints.primarySample` (exact hex match). If brandHints is empty or only has accentCount, fallback to fromVisualAnnotations names containing Primary/Brand, then brand-input.colorPalette.primaryHint. Do not choose accent over explicit brand-base/brand paths merely because accent appears more often.
          4. Mark chosen scale with CSS comment: /* from Set: "{setName}" */
  7.2 authoritativePrimary (HIGHEST PRIORITY — if present, skip 7.1 entirely):
     If a `_type: "authoritativePrimary"` line exists in design-tokens.jsonl, use it directly:
     - `keyColor` → --primary (the definitive brand primary color)
     - `fullScale` → all --primary-{step} scale stops (output every key-value pair as-is)
     - Do NOT re-derive primary from variableSets, semanticColors, or brandHints.
     - Do NOT second-guess or override this value. It has been pre-computed with scale-aware
       confidence scoring and represents the authoritative brand color decision.
  8. Primary scale: output ALL stops that exist in source data. Do NOT enforce a minimum count —
     if source has only 2 stops, output 2. Never interpolate to fill gaps.
     NOTE: the post-processor caps each color group at 10 tokens (evenly sampled) for the
     Theme panel. The CSS itself still carries ALL source stops. ONLY if the user explicitly
     asked to keep longer scales in the Theme panel, declare `/* @max-group-size: N */` at
     the top of the CSS file to raise the cap.
  9. Neutral scale: output ALL stops that exist in source data. No minimum count requirement.
  10. Semantic colors: success, warning, error, info — output ONLY if present in
     design-tokens.jsonl. If source data has NO status colors, output NONE. Do NOT use
     "standard defaults" or invent colors for missing status roles.
  11. Typography: Use fonts from design-tokens.jsonl typography.fonts. Include @import URL for Google Fonts at top of CSS.
     Use typeScale entries directly for .brand-* utility classes.
     FONT FAMILY FIDELITY (HARD): the number of DISTINCT font families in output MUST equal
     the number of distinct families in typography.fonts. If source has exactly 1 family,
     ALL font-family tokens (--font-heading, --font-body, etc.) MUST reference that single
     family — do NOT invent a serif/display/mono pairing that the designer did not use.
     Never copy multi-font examples from spec files when source has fewer families.
     If `typography.fontsByUsage` exists (keys: heading/body/mono/display), use it to assign font families
     to CSS font-family tokens (e.g., `--font-heading`, `--font-body`, `--font-mono`).
     typeScale entries include fontWeight, lineHeight, and letterSpacing — for EACH typeScale entry, emit
     corresponding CSS custom properties in :root {}:
       `--font-size-{role}: {fontSize}px;`
       `--font-weight-{role}: {fontWeight};`
       `--line-height-{role}: {lineHeight};`
     where {role} is the normalized scale name (e.g., h1, h2, body, caption, display).
     The .brand-* typography utility classes should reference these variables:
       font-weight: var(--font-weight-{role});
       line-height: var(--line-height-{role});
  12. Spacing (NAMING CRITICAL):
    a. Use design-tokens.jsonl spacing.observedValues or commonPaddings/commonGaps as source data.
    b. CSS variable names MUST use `--space-{N}` pattern (e.g., --space-1, --space-2, --space-3).
       NEVER name SPACING tokens --spacing-*, --size-*, or --gap-* — those patterns are NOT
       parsed as spacing. (`--size-*` is reserved for component SIZING tokens — see Rule 14b.)
    c. Map source values to ascending --space-{N} scale (smallest value = --space-1).
       If source has named entries (e.g., "sm", "md"), you may also add semantic aliases
       like `--space-sm: var(--space-1)` but the base --space-N tokens MUST exist.
    d. If source has NO spacing data (observedValues empty AND commonPaddings/commonGaps empty),
       output NOTHING for spacing — do NOT invent a default scale.
    e. COMPLETENESS (HARD): output EVERY deduplicated source value — including half-step /
       "off-grid" values (e.g., 2px, 10px, 14px, 18px for a 4px base = 0.5x/2.5x/3.5x/4.5x).
       Do NOT drop values because they don't fit a clean 4px/8px rhythm. The --space-{N}
       suffix is just an ascending index, NOT a multiplier — N does not need to equal value/4.
       After writing, verify: count of --space-* tokens == count of deduplicated source values.
  13. Radius (STRICT MAPPING — no interpolation allowed):
    a. Read radius.observedValues from design-tokens.jsonl — these are the ONLY source-of-truth values
    b. Map each observedValue to the NEAREST alias slot:
       - If an entry has `isKey: true`, assign it to --radius-md (it is the designer's primary radius)
       - If 1 value exists → assign to --radius-md (medium is default)
       - If 2 values exist → assign smaller to --radius-sm, larger to --radius-xl
       - If 3+ values exist → map by ascending size to sm/md/lg/xl; prefer isKey entry for --radius-md
    c. For unmapped alias slots, leave them empty — do NOT fill with default fallback values.
       Only output radius values that trace directly to source data.
    d. NEVER invent radius values — every non-default value MUST trace to an observedValue entry.
       This includes 0: NEVER add a `--radius-none: 0px` (or any 0 value) unless 0 is
       literally present in radius.observedValues or specAnnotations. Do NOT add
       "convenience" slots (none/full/circle) that the designer did not define.
    e. NEVER round or "improve" source values (if source says 4px, output 4px — not 6px)
    f. If specAnnotations has a "radius" category section, use its named values as PRIMARY (Rule 20c applies)
    g. Use `description` field (when present) for naming context and CSS comments
    h. COMPLETENESS (HARD): output EVERY deduplicated observedValue. If source has more
       values than the sm/md/lg/xl alias slots (e.g., 8 values), use ascending numeric
       names (--radius-1 ... --radius-8) for the full set and add sm/md/lg/xl as aliases
       referencing them. After writing, verify:
       count of distinct radius values output == count of deduplicated observedValues
       (no more — nothing fabricated; no fewer — nothing dropped).
  14. Shadows: Each design-tokens.jsonl shadow has `{ name, x, y, blur, spread, color }`.
    a. Generate CSS as `{x}px {y}px {blur}px {spread}px {color}`.
    b. If a shadow entry has `layers` array (length > 1), each layer is a sub-shadow
       `{ x, y, blur, spread, color }`. Join all layers with comma to form a single
       composite CSS box-shadow value (e.g., `0 2px 4px rgba(...), 0 1px 2px rgba(...)`).
    c. Name shadow variables with numeric suffixes ordered by blur ascending: `--shadow-1`, `--shadow-2`, etc.
    d. Use `description` or `usageHint` field (when present) as an inline CSS comment after the semicolon
       (e.g., `--shadow-2: 0 4px 8px ...; /* Card Hover */`). If neither field exists, infer a short
       usage label from the blur level (e.g., "Subtle", "Card", "Float", "Dialog", "Overlay").
       The `css-to-json.mjs` script uses these comments to produce display keys like `shadow-2·Card Hover`.
    e. COMPLETENESS (HARD): output ONE --shadow-N variable for EVERY entry in shadows[].
       If source has 9 shadows, output exactly 9 — do NOT merge "similar" shadows, do NOT
       trim to a 5-level elevation scale to match spec-file examples (those illustrate
       format, not count). Only true duplicates (identical x/y/blur/spread/color across
       all layers) may be deduplicated.
       After writing, verify: count of --shadow-* tokens == shadows[].length (minus exact duplicates).
  14b. Sizing (component dimension tokens — frequently MISSED, check actively):
    a. Sizing data is NOT a dedicated design-tokens.jsonl section — actively mine it from:
       - design-tokens.jsonl size/sizing/dimension fields IF present
       - specAnnotations sections whose texts mention heights/widths/icon sizes
         (e.g., "按钮高度 40px", "icon 16/24", "input height 36px")
       - variables-raw*.md variables whose names contain size/height/width/icon
         (e.g., size/button/md, height/input, icon/lg, 尺寸/*)
    b. CSS variable names MUST use the `--size-*` prefix (e.g., --size-button-height,
       --size-input-height, --size-icon-sm) — this is the ONLY pattern the downstream
       parser classifies into css.json `size`. Layout constraints may also use
       --max-*, --gutter-*, --nav-*, --sidebar-width.
    c. Same fidelity rules as Rule 24: dedup by value, ascending sort, NEVER invent
       values absent from source, output NOTHING if source has no sizing data.
    d. Do NOT misfile sizing values into spacing (--space-*) or radius — a 40px button
       height is a size token, not a spacing step.
  15. Dark theme handling: If your theme decision (Rule 4b) is dual-theme, populate .dark {} as follows:
     a. PRIMARY source: semantic Variables with `{ name, light, dark }` — use `dark` value directly.
        Variables with `{ name, value }` use the same value in both :root and .dark.
     b. SECONDARY source: primitive "Dark/*" scale groups — use for palette scales not covered by (a).
     c. Do NOT infer dark values by inverting light scales or reducing luminance.
        Only output dark values that are explicitly provided in source data.
     If @dark-only or @light-only, there is no separate .dark {} block.
  16. Write the CSS in ONE pass (think while writing — do not pre-draft in reasoning),
      then perform the single read-back REVIEW (Execution step 6); fix defects via
      targeted Edit calls on the file, then write compact report to `ReturnReportFileAbs`.
  17. RETURN BUDGET: ≤ 800 tokens total response.
  18. ALL color values in CSS MUST be 6-digit hex (#rrggbb). For semi-transparent colors use rgba(r,g,b,a) with integer 0-255 channels.
     NEVER output oklch(), hsl(), hwb(), lab(), lch() or any non-hex color function.
  19. Preserve designer's original color names in CSS comments where helpful
     (e.g., /* Brand/primary from Figma */ --primary: #2d6a4f;)
  20. COLOR GROUP NAMING SOURCE (CRITICAL):
      CSS section comments (`/* groupName */`) that drive downstream color grouping
      MUST use the source data's ORIGINAL business naming — not AI-inferred semantic roles.

      Priority for deriving group comment names:
        1. Figma Variable Set / Collection name (e.g., "碧涛青", "arco-blue", "Brand Color")
        2. Figma variable path prefix / folder name (e.g., path "颜色/碧涛青/*" → group "碧涛青")
        3. scaleGroups[].prefix from design-tokens.jsonl (e.g., prefix "arco-blue" → group "arco-blue")
        4. Token name prefix when no other source info exists (e.g., --chart-1 → group "chart")

      Do NOT invent group names based on color appearance or semantic inference.
      Do NOT translate source names (e.g., "碧涛青" must NOT become "cyan" or "teal").
      Do NOT replace source names with generic categories (e.g., "arco-blue" must NOT become "primary").
      The group name is a business identifier — it must match what the designer defined.
  21. specAnnotations (Designer Token Definitions):
     If design-tokens.jsonl contains a `specAnnotations` field:
     The data is pre-filtered to color/radius/typography/shadow/spacing.
     a. For each section with category "typography":
        - Parse texts to identify font family, named sizes (e.g., "title 24px"), and weights
        - Use these as PRIMARY token names/values for typography variables
        - Cross-validate with typography.typeScale data; prefer designer-declared names
     b. For each section with category "spacing":
        - Parse texts to identify named spacing tokens (e.g., "sm 8px", "md 16px")
        - Use these as PRIMARY named spacing values (override observedValues naming)
        - Map to CSS variables: --space-{name}: {value} (MUST use --space-* prefix, NOT --spacing-*)
     c. For each section with category "radius":
        - Parse texts to identify named radius tokens (e.g., "sm 8px", "md 12px")
        - Use these as PRIMARY named radius values
        - Map to CSS variables: --radius-{name}: {value}
     d. For each section with category "shadow":
        - Parse texts to identify named shadow definitions
        - Use these as PRIMARY shadow values (override statistical shadows if names conflict)
     d2. Sizing mentions inside ANY section (no dedicated "size" category exists in the
        pre-filter): texts describing component dimensions — button/input heights, icon
        sizes, control widths (e.g., "按钮高度 40px", "icon 16/24") — MUST be extracted
        as `--size-*` tokens per Rule 14b, regardless of which category section they
        appear under. Do not drop them just because the section is labeled spacing/typography.
     e. Priority: specAnnotations > Figma Variables > statistical observedValues
        (Designer explicitly declared > programmatically bound > passively observed)
     f. If specAnnotations texts are ambiguous or incomplete, fall back to
        existing statistical data (typography.typeScale, spacing.observedValues, etc.)
  22. COLOR GROUPING CONSTRAINTS:
     a. Each color group (CSS section comment) SHOULD contain ≥ 2 tokens, but single-token groups are
        acceptable when they represent a distinct semantic role from source data.
     b. If source data has a color scale (e.g., primary-50 to primary-900), ALL steps of that scale
        MUST be in the SAME CSS section group — never split a scale across groups.
     c. Duplicate HEX values within the SAME group are forbidden — deduplicate and keep the most
        semantically specific name.
     d. COLOR GROUP NAMING:
        Any single lowercase word, hyphenated name, or Unicode name is a valid CSS group comment.
        Name MUST be a single token (no spaces): /* cyan */ ✓, /* 碧涛青 */ ✓, /* light blue */ ✗
        Group names MUST come from the source data's business naming (see Rule 20).
        Do NOT translate or romanize names. Do NOT force names into predefined categories.
        Every source color palette with ≥ 2 scale stops MUST be output.
        DO NOT drop colors because they don't fit a predefined list.
        COMMENT FORMAT (STRICT): The comment MUST contain ONLY the group name — no descriptions,
        arrows, colons, or annotations.
          ✓ /* primary */
          ✓ /* arco-blue */
          ✗ /* primary — Variable set: primary/primary-1..10 */
          ✗ /* aliases → primary */
          ✗ /* primary: brand colors */
        The post-processor identifies groups by these comments; extra text causes misparse.
     e. HUE-FAMILY NAMING (for colors without explicit semantic role):
        Use the hue family name from source data directly as the group name.
        Only map to semantic names (primary, success, error, etc.) when the
        source data explicitly assigns that semantic role (e.g., the variable
        is named "primary-*" or belongs to a "Primary" collection).
        DO NOT force-map decorative palettes into semantic groups.
        A "碧涛青" palette that is NOT the brand primary stays /* 碧涛青 */, not /* primary */ or /* cyan */.
     f. FLAT 2D STRUCTURE: Each color group SHOULD contain only ONE color scale (one hue family).
        A group is strictly two-dimensional: group name → individual tokens of a single hue.
        If source has multiple distinct hue scales (e.g., "lime" and "leaf"), each MUST be its own
        separate CSS comment group — NEVER put multiple hue families under one group comment.
        Example — WRONG:
          /* primary */
          --citrus-lime-50: ...; --citrus-lime-900: ...;
          --citrus-leaf-50: ...; --citrus-leaf-900: ...;
        Example — CORRECT:
          /* lime */
          --citrus-lime-50: ...; --citrus-lime-900: ...;
          /* leaf */
          --citrus-leaf-50: ...; --citrus-leaf-900: ...;
          /* primary */
          --primary: ...; --accent: ...; --ring: ...;
  23. COLOR SCALE COMPLETENESS (CRITICAL):
     a. When source data provides a complete scale (e.g., 10 stops for a hue), EVERY stop MUST be
        preserved in the output CSS — do NOT drop any source color values to save space.
     b. If source has consistent scale counts across color families (e.g., all hues have 10 steps),
        the output MUST maintain this consistency — do NOT output 10 for primary but 3 for neutral.
     c. NEVER interpolate or fabricate color values. If source is missing steps in a scale,
        output only the steps that exist — do not fill gaps.
     d. Output MUST preserve the EXACT hex values from source data — rounding, "improving", or
        adjusting source colors is FORBIDDEN.
  23b. COLOR SCALE ORDERING (within each group):
     Tokens within each color group MUST be sorted by brightness — lightest first, darkest last.
     This ensures consistent visual ordering in the Design Library editor.
     Brightness is determined by the HSL/HSB lightness value of the hex color.
     Example: --primary-1: #e8f3ff; (light) before --primary-10: #001a4d; (dark).
  23c. COLOR GROUP PRIORITY DECLARATION (@group-priority):
     Add a single-line priority comment at the top of colors_and_type.css:
     /* @group-priority: primary, success, info, accent */
     The post-processor (`css-to-json.mjs`) uses this to order color groups in css.json —
     listed groups appear first (in declared order), remaining groups sort by token count.
     STRATEGY — score every candidate group on THREE dimensions; a priority group must
     score well on ALL of them:
     a. Importance: visually RICH and SATURATED groups render as vibrant color cards.
        Put the brand primary group first, then other chromatic groups with many
        saturated tokens (success, info, warning, accent, or named hue palettes like
        "blue", "teal", "violet").
     b. Scale completeness: a priority group MUST have ≥ 4 color tokens (≥ 6 ideal).
        NEVER declare a group with only 2-3 source tokens (e.g., a sparse success pair)
        as priority — it makes the cover image and first screen look thin. Leave sparse
        groups out and let them sort by token count.
     c. Business usage frequency: prefer groups whose colors are actually consumed by
        semantic aliases / components in the source design (--accent, --bg-section,
        button/link states, themeSignals usage hints). A palette that exists in source
        data but is rarely referenced ranks lower than an equally complete, heavily-used one.
     AVOID prioritizing text, background, surface, grey, or neutral groups — they contain
     mostly white/gray/low-saturation colors that produce dull preview cards.
     List 3-5 groups. Do NOT include chart, sidebar, dark, or other utility groups.
  24. PARAMETER DEDUP & SORT (applies to radius, spacing, size — HARD):
     a. ALL numeric token values MUST be deduplicated by value — if two tokens have the same px value,
        merge into one token with the most descriptive name.
     b. Output MUST be sorted in ascending numeric order (smallest value first).
     c. NEVER output a numeric value that does not exist in design-tokens.jsonl observedValues
        (for spacing: spacing.observedValues; for radius: radius.observedValues; for size: only
        values found in source data).
     d. If design-tokens.jsonl has NO data for a category (e.g., spacing.observedValues is
        empty/missing AND no specAnnotations for spacing), output ZERO tokens for that category.
        Do NOT invent a default 4px-based scale when no source data exists.
     e. Mark provenance: /* Source: radius.observedValues */ or /* Source: spacing.commonPaddings */
  25. OUTPUT SECTIONS (source-data-driven — never fabricate):
     The generated CSS SHOULD contain tokens for the following categories
     ONLY IF the source design-tokens.jsonl has data for them:
     - Colors: output if colors.variableSets or resolvedSemanticColors exists
     - Typography: output if typography.fonts or typeScale exists
     - Spacing: output if spacing.observedValues or commonPaddings/commonGaps exists
     - Sizing: output if Rule 14b mining (jsonl size fields, specAnnotations dimension texts,
       variables-raw size/height/width/icon variables) finds any component dimension values
     - Border Radius: output if radius.observedValues exists
     - Shadows: output if shadows[] array has length > 0
     - Motion: output ONLY if source data provides motion/animation values. Do NOT include
       standard defaults — if source has no motion data, omit the motion section entirely.
     If source data does NOT exist for a category, output NOTHING for it (empty is correct).
  26. NAMING CONVENTION (NO-TRANSLATION PRINCIPLE):
     a. Preserve the designer's original token naming from source data. If source uses brand
        prefixes (e.g., --arco-primary-1), keep them. If source uses generic names, keep those.
        Do NOT strip or normalize token names.
        Do NOT translate names between languages (e.g., Chinese → English or vice versa).
        If a token is named --碧涛青-5, it stays --碧涛青-5, never --cyan-5 or --teal-5.
     b. Layer 2 & 3 semantic aliases (if generated) use standard names:
        --primary, --background, --foreground, --color-primary, --color-surface, etc.
        These aliases reference source tokens via var(); they do NOT replace source names.
     c. Within the same semantic category (e.g., status colors), prefer consistent
        naming patterns, but source naming always takes priority.
     d. Group comment names preserve source naming: if the designer's palette is named
        "arco-blue", use /* arco-blue */ as the group. Do NOT strip prefixes from group names.
        Do NOT translate group names (e.g., /* 碧涛青 */ must NOT become /* cyan */).
  27. COLOR PRIMARY MARKING (MANDATORY):
     Every color group MUST have exactly ONE token marked with `/* @primary */` inline comment.
     This is NOT optional — the Design Library card header background depends on this annotation.
     If no token is marked, the post-processor will auto-assign one, but Agent-chosen primaries
     produce better results because the Agent understands semantic intent.
     a. Selection criteria: choose the color that best represents the group's identity —
        typically the most saturated, mid-lightness token (often around the 5th-6th in a 10-stop scale).
     b. For semantic groups (e.g., "primary", "success"), mark the base token (e.g., --primary, --success).
     c. For decorative scales with no clear semantic anchor, choose the token closest to the scale's
        perceptual midpoint that has the highest chroma.
     d. Even groups with fewer than 3 tokens MUST have one @primary marker.
     e. The `css-to-json.mjs` script reads this annotation and sets `isPrimary: true` on the token,
        which the Design Library uses as the card header background color.
  28. COLOR GROUP COHERENCE:
     A color group can be coherent in TWO valid ways:
     a. HUE-BASED: tokens share the same hue family (within ~40° on the color wheel).
        Example: a "blue" scale group with blue-50 through blue-900.
        Achromatic colors (near-white, near-black, grays) are exempt and can appear in any group.
     b. SEMANTIC/NAMING-BASED: tokens share a naming pattern or semantic role, even if they
        span different hues. Example: a "state" group with --state-hover (blue alpha),
        --state-error (red alpha), --state-success (green alpha) — valid because they share
        the "state" semantic role and naming convention.
     Both strategies are valid. Do NOT split a semantically coherent group just because it
     contains multiple hues. The post-processor exempts groups whose tokens share naming
     patterns from hue filtering.
     c. VALIDATION (MANDATORY — execute after writing CSS): Review each color group and verify
        it is coherent by at least one criterion:
        - Same hue family (±40°), OR
        - Shared naming convention (tokens contain the group name), OR
        - Same semantic role (e.g., all are interactive states, all are status indicators)
        If a group has mixed hues AND no naming/semantic relationship, split it into
        separate hue-based groups or consolidate into the nearest semantic parent.
  29. COLOR GROUP SELF-REVIEW (MANDATORY — execute AFTER writing CSS):
     After writing `colors_and_type.css`, read it back and count your CSS comment groups.
     For each group, count how many color tokens (non-alias `var()` declarations with hex/rgba values) it contains.

     RED FLAGS to fix:
     a. **Excessive single-token groups**: If more than 3 groups contain only 1 color token,
        you have fragmentation. Merge each single-token group into the semantically closest
        multi-token group by moving the token under that group's CSS comment.
        - `on-primary`, `primary-container`, `primary-foreground` → merge under `/* primary */`
        - `on-secondary`, `secondary-container` → merge under `/* secondary */` (or `/* neutral */`)
        - `on-surface`, `surface-dim`, `surface-variant` → merge under `/* surface */`
        - `outline`, `outline-variant` → merge under `/* border */` or `/* neutral */`
        - `interactive-hover/focus/press` → merge under `/* primary */` or `/* state */`
        - `muted-foreground` → merge under `/* text */`
     b. **Fabricated tokens**: Any token whose hex value cannot be traced to source data
        (design-tokens.jsonl or variables-raw) MUST be removed entirely — not just regrouped.
     c. **Orphan aliases**: If a `--color-*` alias references a `var(--token)` that exists in
        the same file, it resolves fine. But if it references a non-existent token, DELETE it.
     d. After consolidation, verify: each remaining group has ≥ 2 tokens (ideal) or represents
        a genuinely distinct semantic role from source (acceptable exception).

     If fixes are needed, apply targeted Edit calls on the CSS file (move/delete the
     specific lines — no reasoning re-draft, no whole-file rewrite). This is the LAST step
     before returning the compact contract.

Constraint files (sub-agent reads from disk):
  - {SKILL_DIR}/file-specs/css-tokens.md — CSS file structure, variable naming, required blocks

Input data (sub-agent reads from disk):
  - {tmp_dir}/design-tokens.jsonl — minified 核心数据（designLanguage + 颜色/字体/间距/圆角/结构化阴影 + specAnnotations 设计师 token 标注）
  - {bundle_path}/context/variables-raw*.md — ⚠️ AUTHORITATIVE: 完整的 Figma 变量数据（含所有原始命名和业务语义色），design-tokens.jsonl 仅包含数字后缀的 scale 变量，此文件是颜色完整性的权威来源
  - {bundle_path}/generated/brand-input.jsonl — 品牌分析 (optional supplementary)
  - {bundle_path}/generated/annotations-summary.jsonl — compact 设计师标注与 UI copy 摘要 (optional supplementary, preferred)
  - {bundle_path}/annotations/index.md — 设计师文字说明 (fallback only)

Brand context (self-derived — this task is dispatched in PARALLEL with brand-analyst, so no brand-analyst return is available):
  - Derive ProductType / Personality / Language / KitType from {bundle_path}/generated/brand-input.jsonl (already in your input list — read it in step 3a below).
  - Derive ColorNamingPrefix yourself from the brand signal hue in brand-input (`colorPalette.brandSignalHints` first, `primaryHint` fallback): single lowercase word, hue-accurate or neutral/product-derived when confidence is low (same rule as phase-2-analysts.md Rule 10).

Execution:
  1. Read {SKILL_DIR}/file-specs/css-tokens.md (1 call)
  2. Read {tmp_dir}/design-tokens.jsonl (1 call)
     — Core token data including merged designLanguage overview. Check if `specAnnotations` field exists.
       If present, treat its sections as authoritative designer-declared token definitions (higher priority
       than statistical data). Use `_type: "designLanguage"` line for theme context (style/density/mood).
  3. Read {bundle_path}/context/variables-raw*.md (N calls — read ALL part files: variables-raw.md, variables-raw-part1.md, ..., variables-raw-partN.md)
     — Cross-reference with design-tokens.jsonl to find semantic color variables NOT captured in variableSet stepsMap.
       Any color variable with a meaningful name (e.g. text/*, fill/*, bg/*, border/*) that is absent from
       design-tokens.jsonl MUST be included in your CSS output. This ensures no designer-defined semantics are lost.
  3a. Read {bundle_path}/generated/brand-input.jsonl (1 call) — derive the Brand context fields above (ProductType/Personality/Language/KitType/ColorNamingPrefix)
  4. (Optional) Read {bundle_path}/generated/annotations-summary.jsonl if designerNotes is empty (1 call). Fallback to {bundle_path}/annotations/index.md with limit: 200 lines only when summary is missing or insufficient
  5. Write {output_dir}/colors_and_type.css (1 call)
  6. REVIEW: Read back {output_dir}/colors_and_type.css (1 call). Apply Rule 29 self-check:
     - Count single-token color groups. If > 3 exist, consolidate per Rule 29a.
     - Remove any fabricated tokens (Rule 29b) or broken aliases (Rule 29c).
     - PARAMETER COUNT CHECK (Rules 11/12e/13d/13h/14e/14b — compare against source data):
       * font families: distinct families in CSS == distinct families in typography.fonts
       * shadows: --shadow-* count == shadows[].length (minus exact duplicates)
       * radius: distinct values == deduplicated radius.observedValues (no invented 0/none slots)
       * spacing: --space-* count == deduplicated spacing source values (incl. half-steps)
       * sizing: if source has component dimension data (Rule 14b mining), --size-* tokens
         MUST exist — an empty size section while source has dimensions is a MISS defect
       Any mismatch (missing OR extra) is a defect — fix it.
     - If changes needed: apply targeted Edit calls to {output_dir}/colors_and_type.css
       (fix the specific lines — do NOT re-draft the file in reasoning and do NOT rewrite
       the whole file unless the structure itself is wrong).
     - If no changes needed: proceed directly.
   7. Write compact report to `ReturnReportFileAbs`, then final-respond only `已完成 Token 生成。`.

  Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["{output_dir}/colors_and_type.css"]
  - tokenCount: N (total CSS custom properties generated)
  - flatTokenSummary: "Primary: #xxx (from Figma Variable 'Brand/primary'), Font: xxx, Radius: x/x/x, Spacing: observed values, Shadows: N levels"
  - sourceStats: { fromVariables: N, fromVisualAnnotations: M }
  - semanticCoverage: { criticalResolved: N, criticalMissing: N, warnings: N }
  - provenanceStats: { source: N, derived: N, aliased: N }
  - specAnnotationsUsed: boolean (true if specAnnotations was present and consumed)
  - designTonality: "sharp" | "rounded" | "mixed" (based on radius values: if max radius ≤ 8px → "sharp"; if min radius ≥ 12px → "rounded"; otherwise "mixed")
  - warnings: string[]

  Final response:
    已完成 Token 生成。
```

---

## Key Points for Main Agent

1. **Do NOT wait for brand-analyst** — this Task is dispatched in parallel with brand-analyst (Phase 2 Stage 2); the sub-agent derives brand context from brand-input.jsonl itself
2. **Pass all file PATHS** — sub-agent reads them from disk
3. **DO NOT read sub-agent output** after it returns — use `flatTokenSummary` and `sourceStats` from return
4. **DO NOT verify/fix** token sub-agent output — Phase 5 quality gate will catch structural issues
5. **After return, run 1 script** (deterministic, 0 LLM cost):
   - `node {SKILL_DIR}/scripts/css-to-json.mjs {output_dir}/colors_and_type.css --output {output_dir}/css.json`
6. **Difference from scratch-token-gen.md**: This template uses REAL design data from Figma (design-tokens.jsonl) as ground truth. Colors are NOT AI-generated — they come from the designer's file. No interpolation or fabrication of colors is performed. Semantic aliases (e.g., --color-primary) may be created to reference existing source tokens.

---

## Comparison with scratch-token-gen.md

| Dimension | scratch-token-gen | figma-token-gen (this) |
|-----------|-------------------|------------------------|
| Color source | AI invents based on personality | Figma data (design-tokens.jsonl), no interpolation |
| Font source | AI picks Google Font pairing | Uses fonts from Figma file |
| Spacing source | Standard 4px scale | Uses observed values from Figma |
| Radius source | Derived from personality | Uses observed values from Figma |
| Shadows source | AI generates N-level scale | Uses exact values from Figma |
| Comments style | `/* AI-generated */` | `/* Source: Figma Variable 'xxx' */` |
| Read budget | 1 Read (css-tokens.md) | 2 Reads (css-tokens.md + design-tokens.jsonl) + optional annotations-summary only when designerNotes is insufficient |
