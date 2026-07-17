# Main Agent Repair Flow

> **Audience**: Main Agent ONLY. This file is read by the Main Agent during the post-generation validation/repair phase when a Quality Gate fails. Sub-Agents must NOT read, interpret, or execute anything in this file.

---

---

## [MANDATORY] Batch Repair Protocol — Anti Repair Loop

> This rule takes priority over all individual repair strategies below. Violating this rule causes token explosion and repair deadloops.

### Step 1: Infrastructure First

When `scan-design-directory.mjs` reports infrastructure failures (theme-vars / Tailwind CDN / @theme / @layer base / html class), **immediately batch-run `fill-html-head.mjs --replace-head`** on ALL failed HTML files in a single RunCommand:

```bash
# Fix all pages at once (not one by one)
for file in {designProjectPath}/pages/*.html; do
  node {SKILL_DIR}/script/fill-html-head.mjs {designProjectPath}/colors_and_type.css "$file" --replace-head --lang={lang} --prefix={prefix}
done
```

**[FORBIDDEN]** Manually fixing infrastructure issues with Read/Grep/sed/Write without running fill-html-head.mjs first.

### Step 2: Re-validate Once

Run `scan-design-directory.mjs` to verify.

### Step 3: Warning-Only = Done

If Step 2 results contain only warnings (0 errors), **complete the task immediately**. Do NOT start repair loops for warnings. Warnings are aesthetic suggestions, not blocking issues.

### Step 4: Remaining Errors = Batch Fix

If errors remain, **read all affected files at once**, **batch-fix all issues in a single response**, then **run one final validation**.

**[FORBIDDEN]** Serial "fix one → validate → fix next" loops.
**[FORBIDDEN]** More than 3 total validation runs. If errors persist after 3 validations, keep the current version and inform the user.

## Repair vs Regenerate Decision

> When Step 3/4 Validation detects Quality Gate failures, the Main Agent uses this decision table to choose between repair (cheap) and regeneration (expensive). This operates at the Main Agent level and does NOT change Sub-Agent self-check behavior.

| Failure Type | Detection Method | Strategy | Executor |
|-------------|-----------------|----------|----------|
| Gate 1: Hardcoded colors | Search for `#[0-9a-fA-F]{3,8}` or `rgb(` within `<main>` element's style/class attributes | **Auto-repair**: batch-replace with nearest `var(--{prefix}-xxx)` | Main Agent |
| Gate 2: Head structure broken | `<style id="theme-vars">` or Tailwind CDN missing | **Script repair**: re-run `fill-html-head.mjs <css-path> <html-file> --replace-head` | Main Agent |
| Gate 2: Mixed head write mode | Completion lacks `htmlWriteMode` / `headManagementEvidence`, or page ran skeleton then full-file Write | **Mode repair**: preserve current `<main>`, run `fill-html-head.mjs --replace-head`, then report `htmlWriteMode: "FullHtmlReplaceHead"`; future edits must use `<main>`-only edits | Main Agent |
| Gate 4: Responsive missing | Entire page has no `sm:`/`md:`/`lg:` breakpoint classes | **Regenerate**: re-dispatch Sub-Agent with emphasized "Responsive Layout is mandatory" | Sub-Agent |
| Gate 5: Image path error | `src` does not start with `../assets/` | **Auto-repair**: fix path prefix via Edit tool | Main Agent |
| Gate 7: AI Slop visuals | Blue-purple neon gradients, rainbow effects detected | **Regenerate**: re-dispatch + explicitly forbid the detected pattern in soulElement | Sub-Agent |
| Gate 7.5: Bilingual title mixing | Both Chinese and English phrases (> 2 words) used as headings/labels on same page | **Auto-repair**: replace all foreign-language headings/labels with primary language equivalents | Main Agent |
| Gate 7.5: Component overlap | Absolutely positioned elements lacking explicit non-overlapping offsets, or positioned badge sharing space with text per `visual-zero-tolerance.md` ❷ | **Auto-repair**: add `gap-*` spacing or adjust positioned element offsets | Main Agent |
| Gate 7.5: Oversized heading | Heading with > 8 CJK chars / > 6 English words at any size ≥ `text-xl`, or heading wrapping 2+ lines | **Auto-repair**: reduce heading font-size class to `text-2xl` or `text-xl`, or extract a shorter noun phrase | Main Agent |
| Gate 7.5: Button text wrapping | Button text lacks `whitespace-nowrap` or renders multi-line | **Auto-repair**: add `whitespace-nowrap` + reduce font-size if needed | Main Agent |
| Gate 7.6: Alignment drift | Buttons, tags, form controls, card titles, list rows, table/toolbars, or nav items lack a shared left/right/center/baseline alignment; a tiny element floats alone in a full-width row with arbitrary padding/margin | **Targeted repair**: choose one alignment mode per region, normalize gaps, remove arbitrary offsets, and either complete orphan rows with related content or align/collapse them into the neighboring row | Main Agent |
| Gate 7.6: Sentence heading or long CTA | Heading is a full sentence/clause, heading exceeds the limits in `visual-zero-tolerance.md` ❸, or CTA/button/tab/pill contains a long requirement phrase | **Targeted repair**: extract a short noun phrase heading, move explanatory text to body/subtitle, and shorten CTA/button/tab/pill labels to 2-6 CJK chars or 1-3 English words | Main Agent |
| Gate 10: Mini program chrome incomplete | Detect empty right capsule, missing more/close action, invisible spacer, or brand-styled system chrome in miniProgramStyle pages | **Auto-repair**: replace the nav bar with the standard mini program nav snippet from `html-implementation-mobile.md` | Main Agent |
| Gate 11: Composition pattern missing | Missing `designIntentEvidence.compositionPatternUsed`, or showcase page does not name the planned pattern | **Targeted repair**: preserve content, rebuild first-screen composition around the planned pattern | Sub-Agent |
| Gate 11: Default card wall | Manual judgment: generic hero plus repeated feature cards without business-specific composition | **Regenerate**: re-dispatch with explicit `compositionPattern` and anti-card-wall instruction | Sub-Agent |
| Gate 11: Cross-page style drift | Multi-page report shares fewer than 2 continuity anchors | **Targeted repair**: align Header/Footer, CTA style, surface layering, or type rhythm | Main Agent |
| Gate 11: Project shell drift | Pages ignore `sharedProjectShellContract` or diverge in nav/header/sidebar/footer, primary color, font stack, radius scale, shadow model, CTA style, or alignment rhythm | **Targeted repair**: copy the strongest shell implementation to sibling pages, then reapply only page-specific content | Main Agent |
| Gate 11: Active nav/tab drift | Leaf pages rewrite shared header/sidebar/tab DOM or CSS to mark active state, or shared nav/tab items lack stable `data-nav-key` / `data-tab-key` plus a slot-driven active state | **Targeted repair**: move nav/tab structure and active CSS into the parent fragment, add stable keys, expose `activeNavItem` / `activeTab` slot, and make leaves fill only that slot | Main Agent |
| Gate 11: Generation tree violation | Missing `generationTree` for multi-page/state work, missing `generation-tree.json`, flat top-level `nodes[]`, root-only/incomplete tree, parent and child tasks launched in the same batch, child dispatched before parent completion/status update/output file, parent branch summarized before all children finished, Sub-Agent attempted to dispatch child Sub-Agents, leaf task missing inherited fragments, leaf regenerated or duplicated a shared region, or sibling leaves differ outside declared slots/private regions | **Targeted repair**: write/repair complete nested `generation-tree.json`, mirror it into orchestration summary, generate/repair ancestor fragment first, verify the fragment file exists, mark the parent generated, dispatch child nodes from the Main Agent, then wait/poll until every descendant completion and output file exists before consolidation; reapply only declared mutable slots/private regions | Main Agent |
| Gate 11: State shell drift | Pages with the same `stateGroupId` differ outside declared `mutableRegions`, derived page was rebuilt from scratch, outer `<main>` style/class differs, tab/control bar is detached from the panel frame, or panel wrapper padding/background/border drifts | **Targeted repair**: poll for the base page HTML, copy it to the derived target, then reapply only active-control and mutable-region changes; preserve `<main>`, content wrapper, shared header/summary/tab frame byte-for-byte where possible. Do not run `fill-html-head.mjs` for the derived target | Main Agent |
| Gate 11: Derived base copy missing | Derived page report lacks `derivedFromHtmlSrc`, lacks copy evidence, contains `fill-html-head.mjs` execution evidence, or returned `missing base state html after retry` | **Readiness repair**: generate/finish the base state first, verify the base HTML file exists, then re-dispatch the derived task with poll-and-copy as its first step | Main Agent |
| Gate 11: Floating layer missing close wiring | Modal/drawer/popover page lacks backdrop or close/cancel/back `data-dom-id` entries targeting the source/base page with `hideEdge: true` | **Targeted repair**: add hidden interaction entries and matching HTML `data-dom-id` attributes | Main Agent |
| Content mismatch (major deviation from requirements) | Manual judgment | **Regenerate**: re-dispatch with more explicit content specification | Sub-Agent |

## Color Hardcode Auto-Repair Strategy

When Gate 1 detects hardcoded colors, the Main Agent repair flow:

1. Read `orchestration-summary.json` → `designSource.actualTokenNameReference` for the complete HEX→variable mapping
2. For each hardcoded color value, find the nearest token variable:
   - Exact match → direct replacement
   - No exact match → choose the closest hue match among primary/secondary/accent/muted variables
3. Execute batch replacement using Edit tool
4. Re-validate Gate 1 after replacement
5. **Scope limitation**: Only replace within `<main>` content. [FORBIDDEN] touching `<svg>` internal fill/stroke values (these may be intentionally hardcoded for icon rendering)

## Repair Attempt Limits

- Maximum 1 auto-repair attempt + 1 regeneration attempt per page
- If regeneration still fails, keep current version and inform user of remaining issues in progress message
- [FORBIDDEN] Infinite retry loops

## Image Generation Failure Policy

> Executor: Main Agent (images are pre-generated by the Main Agent; Sub-Agents never generate or retry images). Sub-Agents only consume the resulting asset records and render the approved CSS degradation for `degraded` assets — see `sub-agent-hard-rules.md §Image-Failure-Degradation`.

When image generation encounters errors (504 timeout, service unavailable, rate limiting, etc.):

| Failure Scenario | Required Action |
|------------------|-----------------|
| Single image fails after 1 retry | Abandon that image; mark the asset `degraded` (Sub-Agent renders CSS fallback) |
| ≥ 2 images fail in the same batch | Stop retrying all remaining images; degrade ALL planned images to CSS alternatives |
| Service returns non-200 after retry | Do NOT retry more than once per image; proceed with degradation |

- [FORBIDDEN] Retrying the same image more than once (wastes 30-40s per attempt with high re-failure probability)
- [FORBIDDEN] Blocking page generation while waiting for image retries
- After degradation, keep the asset record with `status: "degraded"` in `orchestration-summary.json` and the "Available image resources" table so Sub-Agents can render the approved CSS fallback for that slot

## Image Generation Prompt Constraints

> Executor: Main Agent (image pre-generation phase).

- The prompt must include `no text, no typography, no letters, no words, no colorful lights, no neon glow, no blue purple light, no light trails, no holographic effect, no gradient lighting`.
- The prompt must NOT include `no watermark` or `no logo` — these phrases prime the model to hallucinate issues that don't exist.
- After image generation, use directly — **any secondary processing of images is forbidden** (including cropping, watermark removal, resizing, regeneration, deletion, or re-generation). If `GenerateImage` returns success, the image is unconditionally accepted; the Agent cannot "see" image content and must trust the tool's confirmation.
