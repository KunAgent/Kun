# Design Project Validation Flow

This document describes all design project validation flows and script usage within the solo-design skill.

## Validation Responsibilities

| Level | Executor | Script | Trigger Timing | Purpose |
|------|--------|------|---------|------|
| **HTML self-check** | **Page Sub-Agent** | Does not run design project validation scripts | After HTML write is complete | Executes `page-generation-quality-gate.md`, then reports artifact path, nodeId, component reads, and quality gate status to Main Agent |
| **Full validation** | **Main Agent** | `scan-design-directory.mjs` | After all sub-tasks complete, before presenting results to user | Confirms all artifacts (directory structure, HTML, assets, theme infrastructure, .design) are correct |

> **Page Sub-Agents must not run design project validation scripts**: `scan-design-directory.mjs` traverses the entire design directory. When executed concurrently, other pages' HTML has not yet been generated, which triggers numerous false positives. `validate-design-file.mjs` validates shared `.design` metadata owned by the Main Agent. After completing HTML generation, Page Sub-Agents perform local HTML style integrity self-checks and report directly to the Main Agent.

> **Concurrent write deadlock note**: When multiple Sub-Agents run in parallel, if each attempts to fix the same .design file, concurrent write conflicts (deadlocks) occur. Therefore, .design file repair responsibility is unified under the Main Agent; Sub-Agents only fix their own HTML output files.

## Sub-Agent: Report Directly After Completion

After writing HTML, the Page Sub-Agent **does not run design project validation scripts** and reports the following information directly to the Main Agent:

```json
{
  "nodeId": "<nodeId assigned during pre-registration>",
  "page": "pages/<page-name>.html",
  "title": "<page title>",
  "domIds": ["<data-dom-id values added in HTML>"],
  "componentsRead": ["<component slugs read from componentPlan>"],
  "extraComponentsRead": ["<bounded supplement component slugs>"],
  "aestheticsRead": ["index.md"],
  "aestheticsSkipped": [],
  "nestingDepthCheck": { "status": "pass", "maxLayersFound": 2, "samplePaths": ["section > card > content"] },
  "qualityGate": "passed"
}
```

The Main Agent collects all Sub-Agent reports (including `domIds` for wiring checklist construction) and then performs unified full validation. If the Main Agent finds HTML errors, it dispatches repair tasks to the corresponding Sub-Agent.

## Generation Intermediate State (Step 2 → Step 3)

**Definition**: After Step 2 (Main Agent pre-registers page skeleton nodes) completes, until Step 3 (all Sub-Agents finish HTML generation) ends, the `.design` file is in an intermediate state:

- `.design` already contains skeleton nodes for all pages (nodeId, htmlSrc, title, etc. are pre-allocated)
- HTML files in the `pages/` directory have not yet been generated

**Validation restrictions during this period:**

| Script | Allowed to Run | Notes |
|------|------------|------|
| `scan-design-directory.mjs` | **Forbidden** | HTML file existence checks will batch-report expected intermediate errors, producing heavy noise and making it impossible to distinguish expected intermediate state from real errors |
| `validate-design-file.mjs` | **Forbidden** | This script is an internal dependency of `scan-design-directory.mjs`; running it directly creates a second validation path and can trigger incorrect repair actions during partial generation |

During intermediate state, the Main Agent may only perform lightweight inspection: read the `.design` JSON, confirm skeleton node IDs / `htmlSrc` / `canvasData.group` values, and avoid running any Skill validation script.

> Missing HTML during intermediate state is **expected behavior** and does not indicate `.design` pre-registration failure. Only after Step 3 is entirely complete and all HTML has been generated should full validation pass.

**Typical error scenario**: If `scan-design-directory.mjs` is run during intermediate state, the script will report all page HTML as missing. The Agent may incorrectly judge Step 2 as failed and rewrite `.design`, causing pre-registered skeleton nodes to be overwritten. **Running any scan-result-based repair actions during intermediate state is forbidden.**

## Main Agent: Full Validation (scan-design-directory.mjs)

After all sub-tasks complete, the Main Agent must execute a one-time complete validation:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <design-directory-path> [--expected-pages=<N>] [--require-interactions=domId1:file1.html,domId2:file2.html,...]
```

**Parameter description:**
- `<design-directory-path>`: Design project root directory path (required)
- `--expected-pages=<N>`: Expected total number of pages (optional; if provided, automatically passed to `.design` file validation)
- `--require-interactions=domId:file.html,...`: Expected wiring checklist (optional; forwarded to `validate-design-file.mjs` to verify each domId exists in the owning HTML file and is registered in `.design` interactions)

**Functionality:**
- Checks directory structure (assets/, pages/)
- Discovers and validates all .design files (internally auto-invokes validate-design-file.mjs and forwards `--expected-pages` / `--require-interactions`)
- Validates HTML file completeness in the pages/ directory
- Validates HTML infrastructure (`theme-vars`, `@theme inline`, Tailwind, Lucide, theme class)
- Blocks forbidden HTML quality issues: hardcoded colors outside `theme-vars`, Tailwind named color utilities, external/base64 images, missing `../assets/` image paths, missing image files, and brand CSS `<link>` usage
- Optionally validates .theme files if theme/ directory exists (non-blocking)
- Checks asset directory status
- Generates a complete validation report

**Exit codes:**
- `0`: Validation passed
- `1`: Validation failed; must fix based on error information and re-validate

## Repair Flow

When validation fails, the Main Agent must **triage errors by owner** before dispatching any repair:

### Error Triage Table

| Error Category | Example Errors | Owner | Repair Method |
|---------------|----------------|-------|---------------|
| **`<head>` infrastructure** | Missing Tailwind CDN, missing `<style id="theme-vars">`, missing `@theme inline`, missing `@layer base`, missing `<html class="light/dark">` | **Main Agent** | Run `fill-html-head.mjs <css-path> <html-file> --replace-head` — this regenerates the entire `<head>` without touching `<main>` content |
| **`<body>` script** | Missing `lucide.createIcons()` | **Sub-Agent** | Dispatch targeted repair: add `<script>lucide.createIcons();</script>` before `</body>` |
| **Custom `<style>` in `<head>`** | Custom style blocks detected in `<head>` | **Main Agent** | Run `fill-html-head.mjs --replace-head` — it automatically relocates custom styles to `<body>` end |
| **Hardcoded colors** | `#f5a623`, `rgb(246, 81, 89)` found outside `theme-vars` | **Sub-Agent** | Dispatch targeted repair: replace hardcoded values with `var(--prefix-*)` tokens using Edit tool |
| **Tailwind named colors** | `bg-blue-500`, `text-red-600` | **Sub-Agent** | Dispatch targeted repair: replace with brand semantic classes |
| **`.design` metadata** | Missing nodes, wrong nodeId, interaction errors | **Main Agent** | Fix `.design` JSON directly |
| **Missing HTML files** | `pages/about.html` not found | **Sub-Agent** | Re-dispatch page generation Sub-Agent |

### Repair Procedure

1. **Triage**: Classify each error using the table above
2. **Main Agent fixes first**: Execute `fill-html-head.mjs --replace-head` for all HTML files with `<head>` infrastructure errors — this is a single batch command that fixes multiple files at once:
   ```bash
   node {SKILL_DIR}/script/fill-html-head.mjs <css-path> page1.html page2.html ... --replace-head
   ```
3. **Then dispatch Sub-Agent repairs**: For `<main>` content issues (hardcoded colors, Tailwind named colors, missing lucide init), dispatch Sub-Agent(s) with targeted Edit instructions — **not full-file rewrites**
4. **Re-validate**: Run `scan-design-directory.mjs` again
5. Repeat steps 2–4 until validation passes

**[FORBIDDEN]** Delegating `<head>` infrastructure repair to Sub-Agents — this causes Sub-Agents to rewrite entire HTML files, destroying content and creating a cycle of re-validation failures.

## Common Omission Patterns

| Omission Pattern | Consequence | Prevention |
|-----------------|-------------|------------|
| Generated HTML but `.design` nodes missing | Canvas blank | Main Agent must pre-register page skeleton nodes before dispatching Sub-Agents |
| `data` is empty array `[]` | Canvas blank | Validation script will catch |
| `.design` registered a file but file was not created | White screen / SDK error | Validation script will catch |
| Used `metadata` instead of `devMetadata` | SDK cannot recognize | Validation script will catch |
| Parallel Sub-Agent writes causing overwrites | Page loss | Only Main Agent writes `.design`; pass `--expected-pages` during gate validation to detect |
| Skipped image pre-generation, page Sub-Agent generates images on its own | Slow, inconsistent image style | Must complete image pre-generation phase before page generation; page Sub-Agents are forbidden from calling image generation tools on their own |
| Sub-Agent fills interactions on its own | Wiring points to wrong page or is missing | Sub-Agent keeps `interactions` as empty array `[]`; Main Agent registers wiring in atomic Step 3.5b |
