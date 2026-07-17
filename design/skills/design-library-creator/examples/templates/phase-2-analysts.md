# Phase 2: Brand Analysis Sub-Task Template

> **Return contract**: The brand-analyst MUST write full JSON to disk AND return a compact summary (per SKILL.md #23, tightened to ≤ 600 tokens) containing ALL orchestration fields needed by Main Agent. Main Agent proceeds to Phase 3 with ZERO file reads between Phase 2 return and Phase 3 dispatch.

---

## Sub-Agent Execution Constraints

These apply to the brand-analyst:
- Tool bans per SKILL.md invariant #16: `TodoWrite`, `Skill`, `Grep`, `RunCommand`, `SearchCodebase`.
- FORBIDDEN additionally: `LS`, `Glob` — no discovery; use only the explicit file lists.
- FORBIDDEN: reading any path not listed in `validFiles` or the task's named input files.
- FORBIDDEN: retrying a NotFound path with another guessed path. Only size-limit retries with `offset`/`limit` are allowed.
- After all required Writes, write the compact report to `ReturnReportFileAbs` and STOP with only `已完成设计规范分析。`. No read-back, no verification prose, no markdown tables.
- SILENT: Do NOT output intermediate reasoning, status updates, or planning text between tool calls. After all Writes are done, write the report file and final-respond only `已完成设计规范分析。`.
- ⚠️ DISPATCH PARAMETER: `subagent_type` MUST be `"general_purpose_task"` (not "Explore", not "search"). Sub-agents WRITE files to disk — they need Write-capable agent type.

---

## brand-analyst

```
Task: Analyze brand identity, product type, and visual personality.
Output: {tmp_dir}/phase2-brand-analyst.json (written to disk)

⚠️ HARD RULES (embedded — do NOT skip):
  1. Brand narrative is inference; token values are not brand evidence by themselves
  2. Prefer structured brand-input and annotations-summary signals over generic design-system labels
  3. If UI copies are only state labels, mark brand confidence lower instead of fabricating
  4. If any Read fails with "exceeds the limit of 64KB" error: Re-read with offset=1, limit=600. Record in warnings: "Partial read: {filename} truncated at ~40KB"
  5. NEVER retry a failed Read without adding offset/limit parameters
  6. Total Read calls budget: ≤ 10
  7. ⚠️ WRITE full analysis JSON to disk, then return ONLY a summary (≤ 600 tokens): productType, confidence, personality keywords, language, kitType, colorNamingPrefix
  8. Write the file to disk, then write the compact report to `ReturnReportFileAbs`. Final response: `已完成设计规范分析。` No verification, no read-back, no extra prose.
  9. kitType mapping guidance (MUST follow):
     - design system / component library / enterprise UI framework → dashboard
     - mobile screens / consumer app / native app patterns → app
     - marketing / landing page / corporate site / portfolio → website
     - editorial / print-inspired / visual-heavy / poster → poster
     - When ambiguous, prefer dashboard over app for B2B/enterprise products
  10. colorNamingPrefix inference (CRITICAL):
     - If `colorPalette.brandSignalHints` exists and is non-empty, derive the prefix from the brand signal's
       HUE (e.g., "bg/bg-brand: #0fdc78" → green hue → prefix could be "jade", "emerald", "mint").
     - If brandSignalHints is empty, use `primaryHint` as fallback for hue inference.
     - NEVER use color-bearing words (e.g., "cobalt", "crimson") if you are unsure of the actual brand hue.
       Prefer neutral/product-derived names (product name abbreviation, brand name) when confidence is low.
     - The prefix must be a single lowercase word (no hyphens), suitable for CSS: `--{prefix}-blue-500`.
  12. productNarrative (MANDATORY in the written JSON): infer 2-3 realistic business scenarios this design system would power, based on the component inventory in brand-input (e.g., table+pagination+filter → "data management console"; chat-bubble → "messaging center"; cards+jumbotron → "marketing site"). Write into the JSON:
     ```json
     "productNarrative": {
       "scenario": "one-line product story (what app/site this system powers)",
       "userTasks": ["task 1 a real user performs", "task 2", "task 3"],
       "screens": [
         { "name": "screen name (product scenario, NOT a token page name)", "purpose": "user goal on this screen", "primaryAction": "single primary CTA label" }
       ]
     }
     ```
     - screens: 2-3 entries; names MUST be product scenarios (e.g., "Customer List", "Order Details"), NEVER design-system specimen pages ("Colors", "Typography").
     - Each screen declares exactly ONE primaryAction.
     - This narrative is consumed by the UIKit planner when the Figma file is a pure design system with no product pages.

Constraint files:
  ⚠️ INLINE READING STRATEGY (replaces bundle-exploration.md read for this analyst):
  --- Reading Priority (brand-analyst) ---
  1. {bundle_path}/generated/brand-input.jsonl — PRIMARY (structured JSONL data, read FIRST; each line is a JSON object with `_type` field, line 0 is meta).
  2. {bundle_path}/generated/annotations-summary.jsonl — Supplementary compact designer notes/UI copy signals (if brand-input lacks copy or token-note signals).
  3. context/brand-clues.md — Fallback brand narrative (only if JSON inputs lack sufficient cues).
  4. annotations/ui-copies*.md — Last resort only if JSON inputs are insufficient.
  Stop when: productType, personality, language, and kitType are determined.
  --- Bundle Structure ---
  Bundle is multi-file Markdown+SVG: tokens/, components/, assets/, pages/, annotations/, context/.
  --- END INLINE ---

  DO NOT Read bundle-exploration.md or design-spec-bundle.md — all needed strategy is above.
  If the above inline section is absent (backward compat), fall back to reading from disk.
Input data:
  - Bundle root path: {bundle_path}
  - Tmp dir: {tmp_dir}
  - Brand input file (PRIMARY source — read this FIRST): {bundle_path}/generated/brand-input.jsonl
  - Valid files (supplementary, ONLY if brand-input.jsonl is insufficient): {validFiles.context}
  - Supplementary files: generated/annotations-summary.jsonl (preferred), context/brand-clues.md and annotations/ui-copies*.md (fallback only if needed)
Execution:
  1. Read {bundle_path}/generated/brand-input.jsonl (primary structured JSONL input — each line is a JSON object with `_type` field)
  2. Optionally read {bundle_path}/generated/annotations-summary.jsonl if brand-input lacks sufficient copy or token-note signal
  3. Fallback to context/brand-clues.md only if JSON inputs lack sufficient signal
  4. Write complete analysis JSON to {tmp_dir}/phase2-brand-analyst.json
  5. Return compact summary
Report file format (`ReturnReportFileAbs`):
  - writtenFiles: ["{tmp_dir}/phase2-brand-analyst.json"]

Final response MUST NOT include JSON or paths. Use only: `已完成设计规范分析。`
  - summary: "Product: CRM dashboard (high confidence). Personality: professional, clean, data-rich. Language: en. Kit: dashboard. Prefix: electric-blue. Warnings: ..."
  - warnings: string[]
```
