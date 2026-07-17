# From-Scratch Token Generation Sub-Task Template

> ⚠️ ROUTE: From-Scratch (GENERATE). Rules from figma-token-gen do NOT apply here.

> Sub-agent generates a complete design token CSS from a BrandProfile.
> Writes 1 file. Writes compact report to `ReturnReportFileAbs` (≤ 4KB).
> Main Agent runs `css-to-json.mjs` after this sub-agent returns.

---

## Sub-Agent Execution Constraints

- Tool bans: per SKILL.md invariant #16 (`TodoWrite`, `Skill`, `Grep`, `RunCommand`, `SearchCodebase`); this template additionally forbids `LS`, `Glob` (no discovery needed — all input paths are explicit).
- SILENT: Do NOT output intermediate reasoning, status updates, or planning text between tool calls. After Write is done, write the report file and final-respond only `已完成 Token 生成。`.
- WRITE-FIRST (anti-overthinking): Do NOT compose the complete token structure in your
  reasoning before writing. After reading the constraint spec, go STRAIGHT to the Write
  call and think WHILE writing — the CSS file itself is your working draft. Correctness
  is enforced by the read-back REVIEW step afterwards, not by upfront mental rehearsal.
  Pre-drafting the full CSS in reasoning wastes tokens and adds no accuracy.
- COMPLETION CAP: per SKILL.md invariant #23. Write all verbose content to disk. Write ONLY compact machine data to `ReturnReportFileAbs`; final response is only `已完成 Token 生成。`.
- ⚠️ DISPATCH PARAMETER: `subagent_type` MUST be `"general_purpose_task"` (not "Explore", not "search"). Sub-agents WRITE files to disk.

---

## Task Template

```
Task: Generate complete token system for brand "{brandName}" ({productType}).
Output (write 1 file):
  1. {output_dir}/colors_and_type.css

NOTE: css.json is derived by a deterministic script
from your CSS output — do NOT write it. phase2-token-analyst.json is REMOVED
(flatTokenSummary in your return value already provides the needed data).

⚠️ CSS OUTPUT BUDGET: ≤200 lines total. Write CSS directly — do NOT spend
reasoning tokens counting variables or designing JSON schemas.

⛔ NO CSS IN REASONING (HARD — budget rule):
NEVER draft, rehearse, or revise CSS content inside your thinking/reasoning.
Any CSS composed in reasoning must be typed AGAIN in the Write call — it is 100% wasted
tokens and adds zero accuracy. Concretely:
  - Reasoning before Write is limited to SHORT decisions (palette hues, font pairing,
    group list, priority order) — never token-by-token content.
  - The FIRST place any `--token: value;` line appears MUST be the Write tool call.
    Compose the CSS inside the Write argument, deciding values as you type.
  - If during REVIEW you find problems, fix them with Edit calls on the FILE.
    Do NOT re-plan or re-draft the corrected CSS in reasoning and rewrite the whole file.

⚠️ HARD RULES (embedded — do NOT skip):
  1. Read constraint specs FIRST: {SKILL_DIR}/file-specs/css-tokens.md
  2. SHARED CONTRACT (HARD): the output MUST satisfy css-tokens.md § Shared Token Contract
     in full — the SAME contract the figma route produces (figma requirements are the
     reference standard; this route only differs in value source: BrandProfile inference
     instead of Figma data). This includes: :root {} + .dark {} blocks, @import for
     Google Fonts, group comment format, in-group lightness ordering, @primary marking,
     @group-priority, category naming, portable aliases, css-to-json.mjs compatibility.
  3. ALL color tokens marked /* AI-generated */ in CSS (not /* Source */ or /* Derived */)
  4. Primary scale: FULL 10-step scale (50, 100, 200, 300, 400, 500, 600, 700, 800, 900) —
     not 5 stops. From-scratch generation has no source-data constraint, so a complete
     scale is ALWAYS expected. Steps must progress smoothly from near-white to near-black
     around the brand hue (consistent hue, saturation peaking at mid-steps).
  5. Neutral scale: FULL 10-step scale (50–900) for backgrounds/text.
  6. Semantic colors: success, warning, error/danger, info — each as a 10-step scale
     (e.g., success-50 … success-900), NOT a single value or sparse pair. Sparse semantic
     groups (2-3 tokens) render as thin, unappealing cards in the Theme panel.
  6b. SCALE LENGTH OVERRIDE: 10 steps is the default AND the post-processor cap.
     ONLY if the user explicitly requested more steps (e.g., "12 阶" / "14-step palette"):
     generate that many steps per scale AND declare `/* @max-group-size: N */` at the top
     of the CSS file — otherwise the post-processor samples scales back down to 10.
     Never exceed 10 steps on your own initiative.
  7. Typography: select real Google Font pairing (display + body). Include @import URL at top of CSS.
     Emit --font-size-*, --font-weight-*, --line-height-* variables in :root {} for each type role
     (display, h1-h4, body, lead, caption, mono). See file-specs/css-tokens.md § Typography Variables.
  8. Spacing (`spacing` key): standard 4px-based scale (4, 8, 12, 16, 24, 32, 48, 64).
     NAMING (same as figma route): variable names MUST use the `--space-{N}` pattern
     (e.g., --space-1: 4px). NEVER --spacing-*, --size-*, or --gap-* for spacing —
     those are not parsed as spacing by css-to-json.mjs.
  8b. Sizing (`size` key): generate component dimension tokens with the `--size-*` prefix
      (the ONLY pattern parsed into css.json `size`). Cover at least: button heights
      (sm/md/lg, e.g., 32/40/48px), input height, icon sizes (16/20/24px) — adjust to the
      brand density keyword (compact/normal/spacious). Do NOT name these --space-* and do
      NOT put dimensions in the spacing scale.
  8c. NUMERIC CATEGORIES (radius/spacing/size — same as figma route): dedup by value
      (no two tokens with the same px), ascending numeric order, concrete px only
      (never calc() or rem).
  9. Radius: derive from style keywords (sharp = 2-4px, rounded = 8-12px, pill = 9999px)
  9b. COLOR SCALE ORDERING (same as figma route): tokens within each color group MUST be
      written lightest first, darkest last (sorted by HSL lightness) — e.g., primary-50
      before primary-900. This keeps the Design Library editor ordering consistent.
  10. Shadows: 5-level elevation scale (`--shadow-1` through `--shadow-5`, ascending blur).
      Each shadow variable MUST have an inline comment describing its usage
      (e.g., `--shadow-1: ...; /* Card */`). The comment becomes the display name in the Design Library.
  11. Dark theme in .dark {} block: invert backgrounds, adjust contrast, desaturate slightly
  12. Write the CSS in ONE pass (think while writing — do not pre-draft in reasoning),
      then perform the single read-back REVIEW (Execution step 3); fix defects via
      targeted Edit calls on the file, then write compact report to `ReturnReportFileAbs`.
  13. RETURN BUDGET: ≤ 800 tokens total response.
  14. ALL color values in CSS MUST be 6-digit hex (#rrggbb). For semi-transparent colors use rgba(r,g,b,a) with integer 0-255 channels. NEVER output oklch(), hsl(), hwb(), lab(), lch() or any non-hex color function.
  15. RECOMMENDED COLOR GROUPS: The CSS SHOULD contain these section comments with tokens:
      /* primary */ — brand primary scale tokens (e.g., primary-50 through primary-900, --primary, --primary-foreground)
      /* text */    — text/foreground tokens (e.g., --foreground, --muted-foreground, any *-foreground tokens)
      /* surface */ — background/surface/structural tokens (e.g., --background, --surface, --card, --popover, --muted)
      These groups drive downstream css.json color categorization. They are recommended for from-scratch
      generation but not mandatory — use whatever group structure best fits the brand personality.
      Additional groups (e.g., /* accent */, /* status */, /* chart */) are welcome.
      COLOR GROUP COMMENT FORMAT (STRICT): Group comments MUST contain ONLY the group name.
      Do NOT add descriptions, arrows, colons, or annotations inside the group comment.
        ✓ /* primary */
        ✓ /* surface */
        ✓ /* arco-blue */
        ✗ /* primary — Variable set: primary/primary-1..10 */
        ✗ /* aliases → primary */
        ✗ /* primary: brand colors */
      The parser identifies groups by these comments; extra text causes misparse.
  16. PORTABLE ALIASES: include consumer-facing aliases compatible with file-specs/css-tokens.md
      (`--color-*`, `--radius-*`, `--type-*`, and related semantic aliases). Component JSON,
      preview pages, docs, and UI Kit must be able to consume these aliases without route-specific token names.
  17. COLOR PRIMARY MARKING (MANDATORY): Every color group MUST have exactly ONE token marked
      with `/* @primary */` inline comment — this is NOT optional. Choose the most saturated
      mid-lightness token (e.g., primary-600 in a 50–900 scale). The Design Library uses this
      as the color group card header background. If Agent does not mark one, the post-processor
      will auto-assign, but Agent-chosen primaries are more semantically accurate.
  18. COLOR GROUP COHERENCE: A color group can be coherent in TWO ways:
      a. HUE-BASED: tokens share the same hue family (±40° tolerance). Example: a "blue" group
         with blue-50 through blue-900. Achromatic tokens (grays) are exempt.
      b. SEMANTIC/NAMING-BASED: tokens share a naming pattern or semantic role, even if they
         span different hues. Example: a "state" group with --state-hover (blue alpha),
         --state-error (red alpha), --state-success (green alpha) — valid because they share
         the "state" semantic role and naming convention.
      Both strategies are valid. Do NOT split a semantically coherent group just because it
      contains multiple hues. The post-processor exempts groups whose tokens share naming
      patterns from hue filtering.
      VALIDATION: After writing CSS, review each color group and verify it is coherent by
      at least one criterion (hue similarity OR naming/semantic relationship). If a group
      has mixed hues AND no naming/semantic relationship, split it.
  19. COLOR GROUP SELF-REVIEW (MANDATORY):
      After writing CSS, read it back and count single-token color groups.
      If more than 3 groups have only 1 token, consolidate them into their semantic parent:
      - `on-primary`, `primary-container` → under `/* primary */`
      - `on-surface`, `surface-*` → under `/* surface */`
      - `outline-*` → under `/* border */` or nearest neutral group
      - `interactive-*` → under `/* primary */` or `/* state */`
      Fix via targeted Edit calls on the file if consolidation is needed (no reasoning
      re-draft, no whole-file rewrite). Each group should have ≥ 2 tokens.
  20. COLOR GROUP PRIORITY DECLARATION (@group-priority):
      At the top of the CSS file (before :root or as the first comment inside :root),
      add a single-line meta comment declaring color group display priority:
      /* @group-priority: primary, success, info, accent */
      The post-processor places listed groups first in css.json in the declared order.
      STRATEGY — score every candidate group on THREE dimensions; a priority group must
      score well on ALL of them:
      a. Importance: visually RICH and SATURATED groups render as vibrant color cards.
         Put the brand primary group first, then other chromatic groups with many
         saturated tokens (success, info, warning, accent, or named hue palettes like
         "blue", "teal", "violet").
      b. Scale completeness: a priority group MUST have ≥ 4 color tokens (≥ 6 ideal).
         NEVER declare a group with only 2-3 tokens (e.g., a sparse success pair) as
         priority — it makes the cover image and first screen look thin. Leave sparse
         groups out and let them sort by token count.
      c. Business usage frequency: prefer groups whose colors actually back the semantic
         aliases and component states (--accent, --bg-section, button/link states). A
         rarely-consumed palette ranks lower than an equally complete, heavily-used one.
      AVOID prioritizing text, background, surface, grey, or neutral groups — they contain
      mostly white/gray/low-saturation colors that produce dull preview cards.
      Mark 3-5 groups. Do NOT include utility groups (chart, sidebar, dark).

Constraint files (sub-agent reads from disk):
  - {SKILL_DIR}/file-specs/css-tokens.md — CSS file structure, variable naming, required blocks

Input data:
  - BrandProfile: {inline brandProfile JSON — ≤ 300 tokens}
  - Style keywords: {personality array from BrandProfile}
  - ProductType: {productType}

Execution:
  1. Read {SKILL_DIR}/file-specs/css-tokens.md (1 call)
  2. Write {output_dir}/colors_and_type.css (1 call)
  3. REVIEW: Read back {output_dir}/colors_and_type.css (1 call). Apply Rule 19 self-check.
     CATEGORY COMPLETENESS CHECK (same as figma route's PARAMETER COUNT CHECK, adapted
     to generation targets instead of source data):
       * color: primary + neutral + each semantic group has the full default scale
         (10 steps, or user-requested N per Rule 6b); every group has one @primary mark;
         tokens within each group ordered light → dark
       * spacing: --space-{N} naming, full 4px-based scale present
       * sizing: --size-* tokens present (button/input heights, icon sizes)
       * radius: --radius-* present per style keywords
       * shadows: --shadow-1..5 each with inline usage comment
       Any missing category or sparse scale is a defect — fix it.
      If fixes needed: apply targeted Edit calls on the file (do NOT re-draft in
      reasoning; do NOT rewrite the whole file). Then write compact report to `ReturnReportFileAbs`.
  
  Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["{output_dir}/colors_and_type.css"]
  - tokenCount: N (total CSS custom properties generated)
  - flatTokenSummary: "Primary: #xxx, Font: xxx, Radius: x/x/x, Spacing: 4px-based, Shadows: N levels"
  - warnings: string[]

  Final response:
    已完成 Token 生成。
```

---

## Key Points for Main Agent

1. **Pass BrandProfile inline** in the Task query (it's ≤ 300 tokens)
2. **Pass constraint file PATHS** — sub-agent reads them from disk
  3. **DO NOT read CSS output** after it returns — use `flatTokenSummary` from `ReturnReportFileAbs`
4. **DO NOT verify/fix** token sub-agent output — if it's wrong, the final validator will catch it
5. **After return, run 1 script** (deterministic, 0 LLM cost):
   - `node {SKILL_DIR}/scripts/css-to-json.mjs {output_dir}/colors_and_type.css --output {output_dir}/css.json`
6. The resulting `css.json` MUST follow `file-specs/css-json.md`; sub-agents never write it directly.
