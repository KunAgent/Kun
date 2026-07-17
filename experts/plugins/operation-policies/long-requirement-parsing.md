# Long Requirement Parsing Strategy (Main Agent — Pre-Execution Preparation)

> **When to read**: During Pre-Execution Preparation, when the user's message exceeds **~500 characters** or contains structured document-like content (numbered sections, feature lists, page specifications, PRD-style requirements). This file provides the parsing strategy to convert large unstructured inputs into actionable design decisions.

---

## Detection Triggers

| Signal | Action |
|--------|--------|
| User message > 500 characters | Apply structured extraction |
| Message contains numbered lists, headings (##), or section markers | Treat as PRD-like document |
| Message contains > 5 distinct page/feature mentions | Apply page prioritization |
| Message mixes brand info + features + visual specs + flow descriptions | Apply multi-dimension extraction |

---

## Phase 1 — Structured Extraction

Parse the user's long-form input into 5 structured dimensions and assign stable requirement IDs to actionable items:

| Dimension | What to Extract | Example |
|-----------|----------------|---------|
| **Business Context** | Industry, target audience, brand name, positioning | "面向中国亲子家庭的绘本阅读平台，品牌名：绘本岛" |
| **Page Inventory** | All mentioned pages/screens (explicit or implied) | "首页、绘本馆、绘本详情、亲子活动、阅读记录、用户中心" |
| **Visual Direction** | Color preferences, style references, mood/tone keywords | "温馨、清新、富有童趣，参考小红书与宝宝巴士" |
| **Feature Requirements** | Specific functionality per page (filters, forms, flows) | "支持年龄段筛选、评分排序、关键词搜索" |
| **Brand Assets** | Logo description, slogan, brand story | "Logo：打开的绘本变成小岛，岛上长树" |

### Requirement ID Rules

Every actionable content/feature requirement must receive a stable ID:

| ID Type | Meaning | Example |
|---------|---------|---------|
| `REQ-CONTENT-###` | Copy/content/data that must appear | `REQ-CONTENT-001` |
| `REQ-FEATURE-###` | Interaction, form, filter, flow, or functional UI | `REQ-FEATURE-001` |
| `REQ-VISUAL-###` | Visual direction, brand, mood, or asset requirement | `REQ-VISUAL-001` |

Use these IDs in the Page Plan and pass page-specific IDs to Sub-Agents through `Long Requirement Context`.

### Extraction Priority

When dimensions conflict or overwhelm capacity:

1. **Business Context** — always preserved (determines everything else)
2. **Page Inventory** — always preserved (determines project scope)
3. **Visual Direction** — always preserved (determines brand CSS)
4. **Feature Requirements** — preserved for core pages; can be simplified for secondary pages
5. **Brand Assets** — optional enrichment; incorporated when present but not blocking

---

## Phase 1.5 — Contradiction Detection (Optional)

> **Skip condition**: If Phase 1 extraction did not produce any Visual Direction keywords that conflict with Feature Requirements scope, skip directly to Phase 2.

After structured extraction, scan for **common contradiction patterns** between dimensions:

| Contradiction Type | Detection Signal | Resolution |
|-------------------|-----------------|------------|
| **Minimalism vs Feature Density** | Visual Direction contains "极简/minimal/简洁" AND Page Inventory has > 5 pages OR Feature Requirements has > 6 features per page | AskUserQuestion: "Your style preference is minimalist, but the feature scope is extensive. Should I (A) keep minimal visual style with compact feature density, or (B) prioritize complete features with a clean but more structured layout?" |
| **Luxury vs Price-Focus** | Visual Direction contains "高端/luxury/奢华" AND Feature Requirements mention "价格醒目/prominently show price/大字体价格" | Resolve WITHOUT asking: luxury can coexist with prominent pricing (e.g., Apple-style "From $999" with generous whitespace). Apply luxury visual treatment to price elements. |
| **Playful vs Professional** | Visual Direction mentions "童趣/playful/fun" AND target audience is "企业客户/B2B/professional" | AskUserQuestion: "The playful style and professional audience may conflict. Should I (A) lean playful with professional structure, or (B) lean professional with playful accents?" |
| **Speed vs Completeness** | User says "快速做/simple version" AND then lists 8+ pages with detailed features | Resolve WITHOUT asking: default to speed — apply standard Page Cap, inform user of phased delivery. |

**Rules**:
- Maximum 1 AskUserQuestion for contradictions (do not chain multiple conflict questions)
- If contradiction has an obvious "both can coexist" resolution → resolve internally without asking
- If no contradiction detected → skip this phase entirely (zero overhead for normal requests)
- [FORBIDDEN] Fabricating contradictions that don't exist in the user's actual words

---

## Phase 2 — Page Prioritization & Scope Control

### Page Cap Table (Unified Caps — SSOT)

All page-count caps across the Skill reference this table. Other files (e.g., `reference-material-handling.md`) cite these values and must not redefine them.

| Scenario | Cap |
|----------|-----|
| Standard project creation | 7 pages (may flex to 9 only when PRD-priority parsing justifies it — see Elastic Cap Rules below) |
| High-fidelity replication: sub-page navigation exploration | 6 sub-pages (see `reference-material-handling.md` §Step 2.5 Multi-page Discovery) |
| High-fidelity replication: generation | up to 8 pages (matches actual source page count — see `reference-material-handling.md` §High-Fidelity Replication Mode) |

### Page Count Assessment

| Mentioned Pages | Strategy |
|-----------------|----------|
| 1–4 pages | Generate all pages — within normal project scope |
| 5–7 pages | Generate all pages — acceptable scope, may need simplified features on secondary pages |
| 8–10 pages | **Apply Elastic Cap** (see below) — default cap 7, can extend to 9 if criteria met |
| >10 pages | **Cap at 7 pages** — explicitly inform user of phased delivery; generate the most critical pages first |

### Elastic Cap Rules (8–10 pages)

The default cap for 8–10 mentioned pages is **7 core pages**. However, the cap extends to **9 pages** when ALL of the following criteria are satisfied:

| Criterion | Description |
|-----------|-------------|
| **All pages are P0** | Every page in the inventory is on a critical business path (no "nice-to-have" pages exist) |
| **Sequential dependency** | Pages form a linear or branching flow where removing any page breaks the user journey (e.g., registration → selection → payment → confirmation) |
| **User explicitly states completeness** | User message contains signals like "完整流程", "所有页面都考虑进去", "覆盖全链路", "complete flow", "end-to-end" |
| **No multi-device split** | The project is single device type (multi-device projects already split the load) |

**When Elastic Cap is triggered**:
- Inform user: "I'll create all {N} pages to cover the complete flow you described."
- Simplify secondary pages' feature density (use Phase 3 ">8 features" strategy for less critical pages)
- Each page's HTML must stay under 800 lines to control token consumption

**When Elastic Cap is NOT triggered** (default):
- Apply standard cap at 7 pages
- Communicate deferred pages per existing rules

### Page Priority Classification

When the page inventory exceeds the cap, classify pages:

| Priority | Classification Rule | Examples |
|----------|--------------------|----------|
| **P0 — Must Have** | Entry point + core business flow pages | Home, Product/Service main page, Core feature page |
| **P1 — Should Have** | Supporting experience pages | Detail page, User center, About/Brand |
| **P2 — Nice to Have** | Auxiliary / edge-case pages | FAQ, Terms, Settings, Error pages |

**Selection rule**: Generate all P0 + as many P1 as fits within the cap. P2 pages are deferred to follow-up.

**Communication**: When deferring pages, inform user naturally: "I'll start with the {N} core pages ({list}). The remaining pages ({deferred list}) can be added once you've reviewed these."

---

## Phase 3 — Feature Density Control

For each page, assess whether the mentioned features are feasible within a single-page design:

| Feature Count per Page | Strategy |
|-----------------------|----------|
| 1–4 features/sections | Normal — implement all |
| 5–8 features/sections | Feasible — implement all but keep each section concise |
| >8 features/sections | **Simplify** — group related features; represent some as compact UI hints rather than full sections |

### Data-Heavy Content Handling

When user provides **actual data content** to display (e.g., health reports, financial data, product catalogs):

| Scenario | Strategy |
|----------|----------|
| User provides raw data tables/numbers | Design appropriate visualization (cards, charts, tables) — do NOT dump raw text |
| User provides a long text block to display "as-is" | Design a readable layout (typography hierarchy, expandable sections, cards) |
| Content exceeds single-page capacity | Split into logical sections; use tabs, accordion, or multi-page flow |
| User expects "AI analysis results" to be displayed | Design a structured report layout (headline → metrics → detail → recommendations) |

---

## Phase 4 — Requirement-to-Page Mapping

After extraction and prioritization, produce a **Page Plan** that the Main Agent uses for Step 2 initialization:

```
Page Plan (from long requirement parsing):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total mentioned: {N} pages
Generating now: {M} pages (Phase 1)
Deferred: {K} pages (listed for follow-up)

| # | Page Name | Type | Key Content | Features |
|---|-----------|------|-------------|----------|
| 1 | {name} | {showcase/info-dense/task-driven} | {2-3 word content summary} | {top 3 features + requirement IDs} |
| 2 | ... | ... | ... | ... |

Visual Direction Summary:
  - Tone: {derived tone from creative-direction.md framework}
  - Color hints: {any explicit colors mentioned}
  - Style references: {competitor/style mentions}
  - Brand assets: {logo/slogan if provided}

Requirement Coverage Matrix:
| Requirement ID | Requirement Summary | Target Page | Required Section/UI | Status |
|----------------|---------------------|-------------|---------------------|--------|
| REQ-FEATURE-001 | {summary} | {page} | {section/component} | planned |
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

This Page Plan feeds directly into:
- `create-project.md` Step 1 (replaces or augments style selection)
- `create-project.md` Step 2 (page list pre-assignment)
- Sub-Agent dispatch (per-page requirements + requirement IDs + acceptance notes)

---

## [FORBIDDEN] Long Requirement Anti-Patterns

| Forbidden Behavior | Correct Approach |
|-------------------|-----------------|
| Asking user to "simplify" or "reduce scope" | Parse and prioritize internally; inform about phasing if needed |
| Ignoring visual/brand clues buried in long text | Extract all dimensions systematically |
| Generating 10+ pages because user mentioned them all | Apply page cap; phase delivery |
| Copying user's raw text into Sub-Agent dispatch verbatim | Distill to structured per-page requirements |
| Asking >2 clarification questions for a detailed requirement | If user wrote a full PRD, they've already decided — execute, don't re-ask |
