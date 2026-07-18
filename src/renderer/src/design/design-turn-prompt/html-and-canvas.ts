import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES,
  defaultFrameSizeForDesignTarget,
  formatDesignContextLines,
  normalizeDesignTarget,
  type DesignContext
} from "../design-context"
import type { CanvasSnapshot } from "../canvas/canvas-snapshot"
import { snapshotToCompactJson } from "../canvas/canvas-snapshot"
import type { OpError } from "../canvas/shape-ops"
import { useDesignSystemStore } from "../canvas/design-system-store"
import type { DesignSystem, DesignToken } from "../canvas/design-system-types"
import { PROJECT_DESIGN_MD_PATH } from '../design-md/design-md-paths'
import { takeLastLintFindings } from "../canvas/design-lint"
import type { DerivedTokens } from "../design-token-extract"
import type { DesignContextLocation, DesignHtmlElementContext } from "../design-composer-context"
import { formatDesignHtmlQualityFindings, type DesignHtmlQualityFinding } from "../design-html-quality"
import type { DesignFrameContext, DesignTurnOptions, ScreenTurnOptions } from './shared'
import { formatCanvasTargetFrameLines, formatContextLocationLines, formatDerivedTokenLines, formatDesignTargetFrameLines, formatScreenManifestLines } from './shared'

/**
 * Screen-target turn prompt: generate HTML for a specific screen frame on the
 * canvas. Combines the HTML generation rules with cross-screen context so the AI
 * can maintain visual consistency across screens (shared palette, typography, etc.)
 */
export function buildScreenTurnPrompt(options: ScreenTurnOptions): string {
  const requirements = options.customPrompt?.trim() || WRITE_PROTOTYPE_DEFAULT_PROMPT
  const editableFiles = options.designNotesPath
    ? `\`${options.artifactRelativePath}\` and \`${options.designNotesPath}\``
    : `\`${options.artifactRelativePath}\``
  const lines = [
    options.basePath
      ? `Kun is asking you to ITERATE on an existing screen design: "${options.screenName}".`
      : `Kun is asking you to design a new screen: "${options.screenName}".`,
    `Workspace: ${options.workspaceRoot}`,
    ...formatProjectDesignSystemLines(options),
    ...formatDesignTargetFrameLines(options.designContext),
    ...(typeof options.screenWidth === 'number' && typeof options.screenHeight === 'number'
      ? [`Selected screen frame: ${Math.round(options.screenWidth)}x${Math.round(options.screenHeight)} canvas pixels.`]
      : []),
    ...formatFrameContextLines(
      options.frameContext ??
        (typeof options.screenWidth === 'number' && typeof options.screenHeight === 'number'
          ? {
              name: options.screenName,
              width: options.screenWidth,
              height: options.screenHeight,
              sizeMode: options.screenSizeMode
            }
          : undefined)
    ),
    ...(options.basePath
      ? [
          `Current design to iterate on: ${options.basePath}`,
          'Read it first, reproduce it, then apply ONLY the changes in the brief below — preserve everything else (structure, content, styling).'
        ]
      : []),
    `Reserved artifact file: ${options.artifactRelativePath}`,
    ...(options.designNotesPath ? [`Design notes file: ${options.designNotesPath}`] : []),
    '',
    `Design requirements: ${requirements}`,
    '',
    'Hard rules:',
    `- Modify ONLY ${editableFiles} during this turn. Do not create or modify any other file.`,
    `- Produce ONE complete standalone HTML document at \`${options.artifactRelativePath}\`; it has already been pre-created so the canvas can preview it while you work.`,
    '- Make the HTML responsive to arbitrary selected frame sizes: use fluid layout, min/max constraints, media queries, and avoid fixed viewport wrappers unless the brief explicitly asks for one.',
    '- Treat the selected frame size above as the real webview viewport. Lay out the page to that viewport; content may scroll vertically when needed, but do not shrink the design to compensate for overflowing content.',
    ...DESIGN_RESIZE_RESPONSIVE_LINES,
    '- Build the complete document efficiently: prefer one coherent `write` when it fits the available tool limits; otherwise use a small bounded number of section-level `edit` calls. Do not fragment the page into dozens of micro-edits.',
    '- Write HTML ONLY through Write/Edit tool calls to the artifact file — never dump HTML into assistant text or into `design_canvas` blocks.',
    ...formatHtmlIterationEditDisciplineLines(options),
    '- Wrap each major section (nav, hero, each card group, footer…) in a top-level element carrying `data-ds-section="<short label>"` — e.g. `<header data-ds-section="导航栏">` — and write sections top-to-bottom. The canvas reads these to show a live "AI is drawing here" cursor as the page builds; they are inert in the final design.',
    ...(options.designNotesPath
      ? [
          `- Keep \`${options.designNotesPath}\` aligned with this screen: brief, selected frame, visual direction, interactions, assumptions, and handoff notes.`
        ]
      : []),
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed.'
  ]

  const manifestLines = formatScreenManifestLines(options.screenManifest, options.artifactRelativePath)
  if (manifestLines.length > 0) {
    lines.push('', ...manifestLines)
  }

  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
  }
  const contextLocationLines = formatContextLocationLines(options.contextLocations)
  if (contextLocationLines.length > 0) {
    lines.push('', ...contextLocationLines)
  }
  const htmlElementLines = formatHtmlElementContextLines(options.htmlElementContext)
  if (htmlElementLines.length > 0) {
    lines.push('', ...htmlElementLines)
  }
  const qualityLines = formatDesignHtmlQualityFindings(options.qualityFindings)
  if (qualityLines.length > 0) {
    lines.push('', ...qualityLines)
  }
  lines.push(...formatDerivedTokenLines(options.derivedTokens))
  lines.push('', ...DESIGN_DELIVERY_LINES, '', ...DESIGN_CRAFT_LINES)
  if (options.mode === 'image') {
    lines.push(
      '',
      'The attached image is the visual specification (a design reference).',
      'Reproduce its layout, colors and typography as faithfully as possible, and make the implied interactions work.'
    )
  }
  const text = options.text?.trim()
  if (text) {
    lines.push('', 'Brief:', text.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  }
  return lines.join('\n')
}

export function formatProjectDesignSystemLines(options: DesignTurnOptions): string[] {
  if (options.canvasSurface === 'code') return []
  if (!options.projectDesignMdSourceHash) return []
  const system = options.canvasDesignSystem
  if (!system) return []
  const tokenNames = Object.keys(system.tokens)
  const componentNames = Object.keys(system.components)
  if (tokenNames.length === 0 && componentNames.length === 0) return []
  return [
    `Project design system: ${PROJECT_DESIGN_MD_PATH} (read this Google-compatible file before designing; it is the single source of truth).`,
    `- Current exact source hash: ${options.projectDesignMdSourceHash}. Pass it as \`expectedHash\` to \`design_system\` updates.`,
    `- Available tokens (${tokenNames.length}): ${tokenNames.slice(0, 20).join(', ') || 'none'}.`,
    `- Available components (${componentNames.length}): ${componentNames.slice(0, 12).join(', ') || 'none'}.`,
    '- Reuse its exact token values and semantic component guidance. Patch YAML structurally and preserve Markdown prose. Do not replace it with an HTML/SVG style guide.',
    ''
  ]
}

export function formatFrameContextLines(frame: DesignFrameContext | undefined): string[] {
  if (!frame || !Number.isFinite(frame.width) || !Number.isFinite(frame.height)) return []
  const name = frame.name?.trim()
  const sizeMode = frame.sizeMode ? `, sizeMode: ${frame.sizeMode}` : ''
  return [
    `Canvas frame context: ${name ? `"${name}" — ` : ''}${Math.round(frame.width)}x${Math.round(frame.height)} canvas pixels${sizeMode}.`,
    '- Use this as the actual webview viewport for layout decisions. Width should match exactly; vertical overflow should become natural page scrolling or frame auto-growth, never a scaled-down miniature.'
  ]
}

export function formatHtmlIterationEditDisciplineLines(options: DesignTurnOptions): string[] {
  if (!options.basePath) return []
  return [
    '- HTML iteration discipline: read the current design first, then prefer surgical `edit` calls over full rewrites when the brief is local. Preserve unrelated DOM order, copy, classes, ids, CSS variables, media queries, scripts, form behavior, `data-*` attributes, and existing prototype links.',
    ...(options.htmlElementContext
      ? [
          `- Selected-element edit: locate \`${options.htmlElementContext.selector}\` in the current HTML before editing; change that element or its nearest local component only. Do not duplicate, relocate, or restyle unrelated sections unless the user explicitly asks.`
        ]
      : [])
  ]
}

export function formatHtmlElementContextLines(element: DesignHtmlElementContext | undefined): string[] {
  if (!element) return []
  const text = element.text.trim()
  const html = element.html.trim()
  return [
    'Selected HTML element context:',
    `- Artifact: ${element.artifactTitle} (${element.artifactRelativePath})`,
    `- CSS selector: ${element.selector}`,
    `- Tag: <${element.tagName.toLowerCase()}>`,
    ...(text ? [`- Current text: ${text.slice(0, 700)}`] : []),
    ...(html ? [`- HTML excerpt: ${html.slice(0, 1200)}`] : []),
    ...(text ? ['- If the brief asks to change copy, wording, labels, or text, edit this element text directly and preserve its surrounding structure/classes.'] : []),
    '- Treat this selected element as the binding target for wording like "this", "here", "这个", "这里", or "选中的". Prefer focused edits to this element and its local styling/children unless the user asks for broader layout changes.'
  ]
}

/**
 * Canvas-target turn prompt: teach the AI to call the renderer-side
 * `design_canvas` tool block. The renderer parses these blocks and runs them
 * through `executeOps`, which atomically applies each batch with one undo entry.
 *
 * Keep the schema documentation here in sync with `shape-ops.ts` ShapeOpSchema.
 */
/**
 * Deterministic intent prior: when the snapshot shows EXACTLY ONE selected,
 * filled image, an "edit it" request almost always means edit-that-image — but a
 * terse brief ("把我的设计改成 task") reads like a new screen to the model, which is
 * the long-standing skew toward building HTML. The renderer already knows the
 * high-signal facts, so we hand the model a hard prior instead of leaning on the
 * prose lanes alone. Hint-only: the model still overrides on an explicit "new
 * page / screen", so the legitimate "use this image as a reference for a screen"
 * case is not regressed.
 */
function deriveSelectedImageEditHint(
  snapshot: CanvasSnapshot | undefined
): { id: string; imageUrl: string } | null {
  if (!snapshot) return null
  const selected = snapshot.shapes.filter((s) => s.selected)
  if (selected.length !== 1) return null
  const only = selected[0]
  if (
    only.type === 'image' &&
    typeof only.imageUrl === 'string' &&
    only.imageUrl.length > 0 &&
    !only.aiImageHolder
  ) {
    return { id: only.id, imageUrl: only.imageUrl }
  }
  return null
}

/**
 * When the user has selected MULTIPLE shapes, call them out explicitly so
 * "align/group/restyle these" has a referent — otherwise the model must scan the
 * snapshot JSON for `selected:true` flags. (One selected shape is already covered
 * by the edit-image prior and the snapshot flag.)
 */
function formatSelectedShapesLines(snapshot: CanvasSnapshot | undefined): string[] {
  if (!snapshot) return []
  const selected = snapshot.shapes.filter((s) => s.selected)
  if (selected.length < 2) return []
  return [
    `The user has ${selected.length} shapes selected — treat "these" / "them" / "选中的" as exactly these:`,
    ...selected.slice(0, 12).map((s) => `- ${s.name} [${s.type}] id ${s.id}`),
    ''
  ]
}

export function formatPreviousOpErrorLines(errors: OpError[] | undefined): string[] {
  if (!errors || errors.length === 0) return []
  const rows = errors
    .slice(0, 8)
    .map((e) => `- [${e.code}] ${e.message}${e.suggestion ? ` — ${e.suggestion}` : ''}`)
  return [
    'YOUR PREVIOUS canvas attempt had errors — these ops did NOT apply (they silently failed). Re-read the current snapshot below and reissue CORRECTED ops: target real shape ids, give parents that exist, and use full fill/stroke objects.',
    ...rows,
    ''
  ]
}

export function summarizeToken(t: DesignToken): string {
  switch (t.kind) {
    case 'color':
      return t.value
    case 'gradient':
      return `${t.value.type} ${t.value.stops.map((s) => s.color).join('→')}`
    case 'type':
      return [
        t.value.fontSize ? `${t.value.fontSize}px` : '',
        t.value.fontWeight ? `w${t.value.fontWeight}` : '',
        t.value.fontFamily ?? ''
      ]
        .filter(Boolean)
        .join(' ')
    case 'space':
    case 'radius':
      return String(t.value)
    case 'shadow':
      return t.value.map((s) => `${s.x}/${s.y} b${s.blur}`).join(', ')
  }
}

/**
 * The active document's design system (tokens + components), injected ABOVE the
 * canvas snapshot so the agent reuses named tokens / stamps components instead of
 * hardcoding hex and re-drawing the same element. Empty when nothing is defined.
 */
function formatDesignSystemLines(system?: DesignSystem | null): string[] {
  const resolvedSystem = system === null ? null : (system ?? useDesignSystemStore.getState().system)
  if (!resolvedSystem) return []
  const tokens = Object.values(resolvedSystem.tokens)
  const components = Object.values(resolvedSystem.components)
  if (tokens.length === 0 && components.length === 0) return []
  const lines: string[] = []
  if (tokens.length > 0) {
    lines.push(
      'Design tokens — REFERENCE these by name (`apply-token`) instead of hardcoding hex; redefining one (`define-token`) re-flows every bound shape:'
    )
    for (const t of tokens) lines.push(`- ${t.name} (${t.kind}): ${summarizeToken(t)}`)
    lines.push('')
  }
  if (components.length > 0) {
    lines.push(
      'Components — stamp with `instantiate` / `instantiate-many` (feed a data row per instance) instead of re-adding shapes:'
    )
    for (const c of components) {
      const slots = c.slots.map((s) => `${s.path}:${s.kind}`).join(', ')
      lines.push(`- ${c.name} (slots: ${slots || 'none'})`)
    }
    lines.push('')
  }
  return lines
}

/**
 * Findings from the agent's last `lint-design-system` run, surfaced at the top
 * of this turn so it repairs them (bind off-token colors, fix contrast, grow tap
 * targets) — the canvas-side generate → lint → repair loop. One-shot (cleared on read).
 */
function formatLintFindingsLines(key?: string): string[] {
  const findings = takeLastLintFindings(key)
  if (findings.length === 0) return []
  return [
    `Design-system lint flagged ${findings.length} issue(s) from your last lint-design-system run — fix these (apply-token / set-style / resize / bulk-edit) before adding more:`,
    ...findings.slice(0, 20).map((f) => `- [${f.code}]${f.shapeId ? ` (${f.shapeId})` : ''} ${f.message}`),
    ''
  ]
}

export function buildCanvasTurnPrompt(options: DesignTurnOptions): string {
  const codeCanvasMode = options.canvasSurface === 'code'
  const snapshot = options.canvasSnapshot
  const snapshotJson = snapshot ? snapshotToCompactJson(snapshot) : '(empty canvas)'
  const errorLines = formatPreviousOpErrorLines(options.previousOpErrors)
  const editHint = deriveSelectedImageEditHint(snapshot)
  const targetFrameSize = defaultFrameSizeForDesignTarget(options.designContext?.designTarget)
  const editHintLines = editHint
    ? [
        `IMPORTANT PRIOR — the user has EXACTLY ONE filled image selected (id "${editHint.id}", imageUrl \`${editHint.imageUrl}\`). Unless they EXPLICITLY ask for a NEW page / screen / 页面, this is the EDIT AN EXISTING IMAGE lane: call generate_image with reference_image_paths: ["${editHint.imageUrl}"], then call design_update_shapes to update that SAME shape's imageUrl. Do NOT call design_create_screen / add-screen and do NOT write or edit HTML.`,
        ''
      ]
    : []
  const selectionLines = formatSelectedShapesLines(snapshot)
  const placementFrameLabel = codeCanvasMode ? 'UI frame placeholders' : 'target screen frames'
  const lines = [
    codeCanvasMode
      ? 'Kun is asking you to operate the Code sidebar whiteboard with the dedicated canvas tools.'
      : 'Kun is asking you to operate the design canvas with the dedicated design tools.',
    `Workspace: ${options.workspaceRoot}`,
    ...formatProjectDesignSystemLines(options),
    ...formatCanvasTargetFrameLines(options.designContext, options.canvasSurface ?? 'design'),
    '',
    ...errorLines,
    ...formatLintFindingsLines(options.canvasFeedbackKey),
    ...editHintLines,
    ...selectionLines,
    'How to respond:',
    codeCanvasMode
      ? '- Call the real canvas tool that directly produces the requested outcome. Use legacy `design_canvas` only for backwards-compatible simple calls.'
      : '- Infer the requested Design outcome, then call the real design tool that directly produces it. Use legacy `design_canvas` only for backwards-compatible simple calls.',
    '- Do not emit markdown/fenced JSON blocks and do not ask the user to manually create a canvas first.',
    '- Before EVERY canvas tool call, inspect the current canvas snapshot below: existing shapes, images, frames, selected bounds, content bounds, occupied frames, recommended slots, and bounded `motion` timelines are the factual state. Preserve existing canvas objects unless the user explicitly asks to replace/delete them. Preserve stable Motion ids when updating an existing timeline.',
    '- For new screens, style-kit/design-system boards, generated images, frames, groups, or annotations, choose a non-overlapping placement from `placement.recommendedSlots`, `placement.contentBounds`, `placement.selectedBounds`, or the listed shape x/y/w/h values. Do not place a new large object over an existing image or frame just because the viewport is empty-looking.',
    codeCanvasMode
      ? '- NEVER paste raw HTML into assistant text and NEVER put HTML/`write`/`content` payloads inside design tools. This Code whiteboard is editable shapes; for UI sketches, compose frames/text/rects/images instead of writing files.'
      : '- NEVER paste raw HTML into assistant text and NEVER put HTML/`write`/`content` payloads inside design tools. Screen HTML is written by the system via Write/Edit tools after a screen frame is created.',
    '- The renderer validates each tool call, applies it atomically (one undo entry per call), and visually highlights the affected shapes for ~1s.',
    '- Keep tool use bounded: prefer the fewest calls that complete the requested visible outcome. Batch related screens in one `design_create_screen.screens` call and related shape operations in one focused `design_update_shapes.ops` call. Do not emit one call per shape.',
    ...(codeCanvasMode
      ? []
      : [
          '- DESIGN FOUNDATION GUIDANCE — before building a complete product or multi-screen experience, check whether a valid root `DESIGN.md` source is listed above. If it exists, read and follow it before designing. If it is absent, normally call `design_system` with `operation: "create"` before `design_create_screen` so the screens share a real project-level foundation. This is a preferred sequence, not a hard gate: a quick exploration or an explicit user request to skip the design system may proceed directly to screens.',
          '- DESIGN-SYSTEM CLAIMS MUST BE FACTUAL — say that screens share a unified design system only when a valid root `DESIGN.md` was already listed or a `design_system` call succeeded in this turn. Per-screen `.kun-design/.../DESIGN.md` notes and visually similar page CSS do not count as the project design system.'
        ]),
    '',
    'FIRST classify the request and commit to ONE primary lane:',
    '- EDIT AN EXISTING IMAGE — the user wants to change/edit/restyle/redo/recolor/fix/transform a picture that is ALREADY on the canvas, and the snapshot has a SELECTED `image` shape carrying an `imageUrl`. Phrasings like "change X into Y", "把这张图改成…", "改成 X", or "改一下这张图" all land here when the selected picture is the thing being changed. → call `generate_image` with `reference_image_paths` set to that `imageUrl`, then `design_update_shapes` that same shape (full rules under "Editing or restyling an EXISTING image" below). In this lane you MUST NOT use `design_create_screen` / `add-screen` and MUST NOT write or edit any HTML file.',
    '- FILL AN EMPTY SLOT — a selected empty holder / frame / rect (no `imageUrl`) needs a fresh picture. → `generate_image` from text only, then place it (see "Filling a selected panel" below).',
    ...(codeCanvasMode ? [] : [
      '- ANIMATE A DESIGN FRAME OR LAYERS — the user asks for timeline/keyframe animation of existing canvas shapes or a whole HTML/running-app/SVG frame container. → use `design_motion_set_timeline`, `design_motion_upsert_keyframes`, `design_motion_apply_preset`, or `design_motion_delete` with stable ids from `snapshot.motion`. This is editable per-frame Motion; do NOT generate CSS/GSAP/HTML animation and do NOT use ShapeOps for keyframes.',
      '- CREATE AN SVG OR SVG-MOTION ASSET — the user asks for a vector logo/icon/loader/illustration, path animation, animated mark, or reusable animated vector asset. → call `design_svg_create` exactly once with a clear name, self-contained brief, and optional dimensions. The system then opens a dedicated SVG turn with structured element and animation tools. SVG motion edits the standalone SVG inner animation; it is not the outer Design Motion timeline.',
      '- EDIT PROTOTYPE NAVIGATION — the user asks what happens after a click, which screen opens, or how screens/routes connect. → preserve or edit Prototype links/navigation. Prototype is screen-to-screen navigation; do NOT encode it as a time-based Motion timeline.'
    ]),
    '- CREATE A STANDALONE RASTER IMAGE ASSET — the user asks for a photo, textured/painterly illustration, poster, mascot, or other raster visual material, not a full page/screen. → call `generate_image`, then add/update an `image` shape on the canvas with the saved workspace-relative path. Keep it as a reusable whiteboard asset for later page drafts. Do NOT call `design_create_screen` and do NOT write or edit HTML.',
    ...(codeCanvasMode
      ? [
          '- MAP CODE / ARCHITECTURE / FLOW — the user asks for system architecture, code structure, module relationships, data flow, API flow, state machine, database/schema map, sequence diagram, dependency graph, implementation plan, or debugging notes. → use `design_update_shapes` / `design_arrange` with normal frames, rects, text, arrows, lines, groups, and auto-layout. Do NOT use `design_create_screen` unless they explicitly ask for a UI screen mockup. If they also ask for an image/PNG/SVG/file, call `design_export_canvas` directly when the current snapshot already contains the requested diagram; otherwise finish the editable diagram first and then export it.'
        ]
      : []),
    codeCanvasMode
      ? '- SKETCH A SCREEN OR UI FRAME — the user wants a page/screen/UI mockup on the Code whiteboard. → call `design_create_screen` to create a plain editable frame, then add normal child shapes with `design_update_shapes`. No HTML artifact is generated in Code mode. A selected image in this lane is only a visual reference — do NOT overwrite it.'
      : '- BUILD A SINGLE SCREEN — the user asks for one page, screen, state, component demo, or focused redesign ("做一个登录页", "设计一个详情页"). → make exactly one `design_create_screen` call with `name` and a self-contained `brief`. Do not add extra pages, directions, logos, or a design-system board unless requested.',
    ...(codeCanvasMode
      ? []
      : [
          '- BUILD A COMPLETE MULTI-SCREEN EXPERIENCE — the user explicitly asks for a complete product, a set of pages, an end-to-end flow, multiple named screens, or wording such as "整套", "完整", "多页面", or "全套". → follow the DESIGN FOUNDATION GUIDANCE above, then make one `design_create_screen` call with a `screens` array containing all necessary named screens and a self-contained brief for each. If pages are not named, choose the smallest coherent set that covers the main product flow.',
          '- SCOPE AMBIGUITY — if it is genuinely unclear whether the user wants one screen or a complete multi-screen experience and that choice materially changes the work, ask one concise question with `user_input` and wait. Otherwise choose the narrowest reasonable scope and act.'
        ]),
    codeCanvasMode
      ? '- CREATE OR UPDATE A DESIGN SYSTEM — use `design_system` only when the user explicitly asks for reusable whiteboard tokens/components. It updates structured state and never draws a separate style-kit board.'
      : '- CREATE OR UPDATE A DESIGN SYSTEM — the user asks for a unified template, theme, style guide, design system, tokens, palette, typography, or "make pages consistent". → call `design_system`; it updates root `DESIGN.md`, which the built-in fixed specimen board renders automatically. Then use `design_validate`. Never draw a separate HTML/SVG/style-kit board.',
    '- EDIT THE CANVAS — add, move, restyle, group, annotate, or replace images. → use `design_update_shapes` with the structural ops below.',
    '- ARRANGE THE WHITEBOARD — align, distribute, stack, grid, or responsive reflow existing objects. → use `design_arrange` instead of hand-writing many move ops.',
    codeCanvasMode
      ? 'When a filled `image` is selected and the verb is change/edit-like, choose EDIT AN EXISTING IMAGE over SKETCH A SCREEN OR UI FRAME.'
      : 'When a filled `image` is selected and the verb is change/edit-like, choose EDIT AN EXISTING IMAGE over either screen-building lane.',
    '',
    'Dedicated design tool schemas:',
    codeCanvasMode
      ? '- `design_create_screen`: { "name": "Frame Name", "brief"?, "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" } OR { "screens": [ ... ] }. Omit width/height/devicePreset unless the user asks for a custom device or breakpoint; omitted x/y are placed in the current viewport, and omitted dimensions follow the current target (Web -> desktop 1280x800, App -> mobile 390x844). In Code mode this creates plain editable frame shapes only; no HTML is generated.'
      : '- `design_create_screen`: { "name": "Screen Name", "brief"?, "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" } OR { "screens": [ ... ] }. Omit width/height/devicePreset unless the user asks for a custom device or breakpoint; omitted x/y are placed in the current viewport, and omitted dimensions follow the current target (Web -> desktop 1280x800, App -> mobile 390x844). The system auto-generates HTML afterwards.',
    '- `design_update_shapes`: { "ops": [ ShapeOp, ... ] }. Edits vector layers/images on the active board.',
    '- `design_arrange`: { "operation": "align"|"distribute"|"stack"|"grid"|"responsive_reflow", ... }. Use for layout mechanics and whiteboard cleanup.',
    ...(codeCanvasMode
      ? ['- `design_export_canvas`: { "format"?: "png"|"svg", "name"?: "short-file-stem" }. Call only when the user explicitly asks for an image/export/file. If the current snapshot already contains the requested diagram, export it directly without recreating or modifying shapes. PNG is the default.']
      : []),
    codeCanvasMode
      ? '- `design_system`: { "operation": "create"|"update"|"apply"|"validate", ... }. Updates thread-scoped structured tokens/components without drawing a board.'
      : '- `design_system`: { "operation": "create"|"update"|"apply"|"validate", "expectedHash"?, "name"?, "seedColor"?, "mode"?: "light"|"dark"|"both", "template"?: "app"|"saas"|"game"|"editor"|"mobile"|"portfolio", "tone"?: "clean"|"playful"|"premium"|"technical"|"editorial", "targetIds"? }. Updates root DESIGN.md; pass the exact source hash when known. Its fixed board appears automatically.',
    '- `design_validate`: { "targetIds"? }. Runs design-system lint so the next turn sees off-token colors, contrast issues, and tap-target problems; pass targetIds only when the user selected a specific screen/component to validate.',
    ...(codeCanvasMode ? [] : [
      '- `design_motion_set_timeline`: { "frameId": "<stable frame/root id>", "durationMs"?, "playback"?: "once"|"loop"|"ping-pong" }. Configures the canonical frame timeline.',
      '- `design_motion_upsert_keyframes`: { "frameId": "...", "targetShapeId": "...", "property": "x"|"y"|"rotation"|"scaleX"|"scaleY"|"opacity", "operation"?: "set"|"offset"|"scale", "baseValue"?, "delayMs"?, "spanMs"?, "keyframes": [{ "id"?, "timeMs": N, "value": N, "easing"?: { "type": "linear"|"ease-in"|"ease-out"|"ease-in-out"|"hold"|"cubic-bezier"|"spring", ... } }] }. Reuse stable track/keyframe ids from `snapshot.motion` when editing.',
      '- `design_motion_apply_preset`: { "frameId": "...", "targetShapeIds": ["..."], "preset": "fade"|"move"|"scale"|"rotate", "direction"?: "in"|"out", "durationMs"?, "delayMs"?, "staggerMs"?, "distanceX"?, "distanceY"?, "scaleFrom"?, "scaleTo"?, "degrees"?, "easing"? }. Presets compile to ordinary editable tracks.',
      '- `design_motion_delete`: { "kind": "timeline"|"track"|"keyframe", "frameId": "...", "trackId"?, "targetShapeId"?, "property"?, "keyframeId"?, "timeMs"? }. Missing items delete idempotently.',
      '- `design_svg_create`: { "name": "Animated Logo", "brief": "...", "x"?, "y"?, "width"?, "height"? }. Creates one first-class .svg artifact and hands it to the dedicated SVG tools in the next automatic turn.'
    ]),
    '- Legacy `design_canvas`: { "action": "create_board"|"add_screen"|"update_shapes", ... } remains accepted, but prefer the dedicated tools above.',
    '',
    'ShapeOp vocabulary for `update_shapes.ops` (each op is a JSON object inside the array):',
    '- { "op": "add", "shape": { "type": "rect"|"ellipse"|"text"|"frame"|"group"|"image"|"arrow"|"line"|"draw", "name"?, "x"?, "y"?, "width"?, "height"?, "rotation"?, "fills"?, "strokes"?, "cornerRadius"?, "shadows"?, "blendMode"?, "layout"?, "constraints"?, "textContent"?, "fontSize"?, "fontFamily"?, "fontColor"?, "textAlign"?: "left"|"center"|"right", "lineHeight"?, "clipContent"?, "imageUrl"?, "points"?, "arrowheadStart"?, "arrowheadEnd"? }, "parentId"? }',
    '- { "op": "update", "id": "<shape-id>", "patch": { ...same fields as shape (no type)... } }',
    '- { "op": "delete", "id": "<shape-id>" }',
    '- { "op": "duplicate", "id": "<shape-id>", "count"?: N, "offset"?: { "dx": N, "dy": N } }  // copies the shape (and its children) N times, each staggered by offset (default 24,24)',
    '- { "op": "reorder", "id": "<shape-id>", "action": "front"|"back"|"forward"|"backward" }  // change layer/z-order among siblings',
    '- { "op": "reparent", "id": "<shape-id>", "newParentId": "<parent-id>", "index"? }',
    '- { "op": "move", "ids": ["<id>",...], "dx": N, "dy": N }',
    '- { "op": "resize", "id": "<shape-id>", "bounds": { "x": N, "y": N, "width": N, "height": N } }',
    '- { "op": "align", "ids": ["<id>",...], "axis": "left|h-center|right|top|v-center|bottom" }  // ≥2 ids',
    '- { "op": "distribute", "ids": ["<id>",...], "axis": "horizontal|vertical" }  // ≥3 ids',
    '- { "op": "group", "ids": ["<id>",...], "name"?, "asFrame"?: true }  // wrap shapes into a group (or frame) you can move/style/lay-out as one unit',
    '- { "op": "ungroup", "id": "<group-id>" }  // dissolve a group/frame, lifting its children up one level',
    '- { "op": "set-style", "ids": ["<id>",...], "style": { "fills"?, "strokes"?, "cornerRadius"?, "opacity"?, "shadows"?, "blendMode"?, "fontColor"?, "fontSize"?, "fontFamily"?, "fontWeight"?, "textAlign"?, "lineHeight"? } }  // apply ONE style to many shapes at once — use this instead of N separate update ops',
    '- { "op": "auto-layout", "id": "<frame-or-group-id>", "layout": { "direction": "horizontal"|"vertical", "gap"?, "padding"?, "paddingTop"?, "paddingRight"?, "paddingBottom"?, "paddingLeft"?, "primaryAlign"?: "start"|"center"|"end"|"space-between", "counterAlign"?: "start"|"center"|"end" } }  // flex-style; children reflow automatically with even gap/padding. Add "clear": true to remove it.',
    codeCanvasMode
      ? '- { "op": "add-screen", "name": "Frame Name", "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" }  // legacy alias accepted inside `design_update_shapes`; in Code mode this creates a normal editable frame; omitted devicePreset follows Web/App target'
      : '- { "op": "add-screen", "name": "Screen Name", "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" }  // legacy alias accepted inside `design_update_shapes`; prefer `design_create_screen`; omitted devicePreset follows Web/App target',
    '',
    'Design-system ops (use these for cohesion + batch — they make "change the brand color" or "12 identical cards" one call instead of N edits):',
    '- { "op": "define-token", "name": "brand/primary", "kind": "color"|"gradient"|"type"|"space"|"radius"|"shadow", "value": <by kind> }  // color: "#3b82d8"; gradient: a full gradient fill; type: { fontSize?, fontWeight?, fontFamily?, lineHeight?, textAlign?, fontColor? }; space/radius: a number; shadow: a shadows array. Redefining an existing token re-flows every shape bound to it.',
    '- { "op": "delete-token", "name": "brand/primary" }  // removes the project token and safely unbinds it from live shapes without changing their last resolved visual value.',
    '- { "op": "apply-token", "ids": ["<id>",...], "prop": "fill"|"stroke"|"text-color"|"font"|"radius"|"shadow"|"gap"|"padding", "token": "brand/primary" }  // binds the shapes to the token (so a later define-token edit updates them). Prefer this over hardcoding a hex you used elsewhere.',
    '- { "op": "define-component", "name": "ProductCard", "fromId": "<shape-id>", "slots": [{ "path": "<descendant shape name>", "kind": "text"|"image"|"color"|"visible" }] }  // turn a well-made shape/subtree into a reusable component; `slots` name the parts each instance can override (matched by the descendant\'s name).',
    '- { "op": "delete-component", "name": "ProductCard" }  // removes the component definition; existing instances keep their current appearance and are detached.',
    '- { "op": "set-component-variant", "name": "ProductCard", "key": "size=compact", "selection": { "size": "compact" }, "overrides": { "<stable layer id>": { "width"?: N, "height"?: N, "fills"?: [...], "textContent"?: "..." } } }  // stores variant properties as overrides on the base component tree; identity/hierarchy fields cannot be overridden.',
    '- { "op": "instantiate", "name": "ProductCard", "variant"?: "size=compact", "at": { "x": N, "y": N }, "parentId"?, "overrides"?: { "<slot name>": <value> } }  // stamp one instance; overrides feed the slots (text→textContent, image→imageUrl, color→hex fill, visible→bool).',
    '- { "op": "instantiate-many", "name": "ProductCard", "data": [ { "<slot>": <value> }, ... ], "layout": { "kind": "grid"|"row"|"column", "cols"?: N, "gap"?: N }, "at"?: { "x": N, "y": N }, "parentId"? }  // BATCH: one instance per data row, auto-placed on a grid. Use this for card walls / lists / repeated rows instead of N add ops.',
    '- { "op": "update-component", "name": "ProductCard", "fromId": "<edited shape-id>" }  // re-snapshot the master from an edited instance/subtree; every other instance re-flows, keeping its own overrides.',
    '- { "op": "detach", "id": "<instance root id>" }  // cut an instance loose from its component so it can diverge freely.',
    codeCanvasMode
      ? '- { "op": "add-screens", "specs": [ { "name": "Home", "brief"?, "devicePreset"?, "x"?, "y"? }, ... ] }  // BATCH: create several plain editable frames in one call (auto-arranged around the user\'s current viewport, wrapping when needed); no HTML is generated in Code mode.'
      : '- { "op": "add-screens", "specs": [ { "name": "Home", "brief"?, "devicePreset"?, "x"?, "y"? }, ... ] }  // BATCH: create several screen frames in one call (auto-arranged around the user\'s current viewport, wrapping when needed); each gets its HTML generated afterwards.',
    '- { "op": "bulk-edit", "filter": { "type"?, "nameContains"?, "boundToken"?, "component"?, "inFrame"? }, "set": { ...style fields... } }  // restyle every shape matching the filter in one call (e.g. round all buttons, recolor every ProductCard).',
    '- { "op": "grid", "id": "<frame/group id>", "cols": N, "rowGap"?, "colGap"? }  // arrange a container’s existing children on a grid (cell = largest child).',
    '- { "op": "stack", "ids": ["<id>",...], "direction": "horizontal"|"vertical", "gap"?, "name"?, "asFrame"?: true }  // wrap loose shapes into one auto-layout container (group + auto-layout in a single step).',
    '- { "op": "responsive-reflow", "frameId": "<id>", "device": "mobile"|"tablet"|"desktop" }  // resize a frame to a device preset and re-flow constrained children.',
    '- { "op": "apply-theme", "ids": ["<id>",...], "remap": { "<oldToken>": "<newToken>" } }  // re-skin a subtree by rebinding its token-bound props to themed tokens (e.g. light→dark). Define both token sets first.',
    '- { "op": "recolor", "ids": ["<id>",...], "mapping": { "<oldHex>": "<newHex>" } }  // swap exact colors across a subtree (escape hatch for un-tokenized art).',
    '- { "op": "variant-matrix", "baseId": "<id>", "devices"?: ["mobile","desktop"], "themes"?: [ { "name": "dark", "remap": { "<oldToken>": "<newToken>" } } ], "gap"?, "at"? }  // BATCH: tile clones of a base across device × theme cells, each reflowed + themed. The flagship "show it everywhere" op.',
    '- { "op": "lint-design-system", "targetIds"? }  // self-check the design for off-token colors, low text contrast, and sub-44px tap targets. Omit targetIds for the whole board; pass selected screen/component ids for scoped validation. Findings surface at the top of your NEXT turn — fix them there. Run this after a big batch.',
    '',
    'Styling vocabulary:',
    '- Solid fill: `{ "type": "solid", "color": "#3b82d8", "opacity": 1 }`. Gradient fill: `{ "type": "linear", "angle": 90, "stops": [{ "offset": 0, "color": "#6366f1" }, { "offset": 1, "color": "#8b5cf6" }], "opacity": 1 }` (or `"type": "radial"`, no angle). `angle` is degrees clockwise: 0 = left→right, 90 = top→bottom.',
    '- Shadows: `"shadows": [{ "x": 0, "y": 4, "blur": 12, "color": "#0f172a", "opacity": 0.18 }]` for elevation (use `"type": "inner"` for inset). Stack multiple for layered depth. Reuse one elevation across a set of cards via `set-style`.',
    '- `blendMode`: any CSS mix-blend-mode ("multiply", "screen", "overlay", …) for compositing.',
    '',
    'Rules:',
    codeCanvasMode
      ? '- Use `design_create_screen` / `add-screen` ONLY when the user actually wants a UI screen/frame sketch on the Code whiteboard. It creates an editable frame placeholder only; there is no follow-up HTML generation in Code mode. Do NOT call write/edit tools to create HTML files for this whiteboard.'
      : '- Use `design_create_screen` ONLY when the user actually wants one new screen or a complete multi-screen experience (the two BUILD lanes above). If a filled `image` is selected and the user asked to change / edit / restyle it, do NOT create a screen / add-screen — edit that image instead. Screen creation only creates the frame placeholder; the system will AUTOMATICALLY generate the HTML content for the screen in a follow-up step. Do NOT call write/edit tools to create HTML files in this turn.',
    ...(codeCanvasMode
      ? [
          '- For code/architecture diagrams, prefer semantic boxes and labeled arrows: services/modules as frames or rects, files/functions as smaller rects, data/events as arrows, notes as text, and related parts grouped with auto-layout. Keep labels short enough to fit.',
          '- `design_export_canvas` exports the actual editable whiteboard rendering. Never substitute `generate_image` for diagram export. Do not export automatically when the user asked only for an editable diagram.'
        ]
      : []),
    '- Coordinates are in CANVAS pixels (not screen pixels); 1 unit ≈ 1px at 100% zoom.',
    codeCanvasMode
      ? '- ALL coordinates are ABSOLUTE — including shapes inside a frame or group. `parentId` sets logical grouping only; it does NOT offset coordinates. To place a child at the top-left of a frame at (200, 100), give the child x≈200, y≈100 (not 0, 0). The snapshot positions below are likewise absolute. For new UI frame placeholders, omit x/y unless the user asked for a precise placement; the app will place them in the user\'s current viewport.'
      : '- ALL coordinates are ABSOLUTE — including shapes inside a frame or group. `parentId` sets logical grouping only; it does NOT offset coordinates. To place a child at the top-left of a frame at (200, 100), give the child x≈200, y≈100 (not 0, 0). The snapshot positions below are likewise absolute. For new screen frames, omit x/y unless the user asked for a precise placement; the app will place them in the user\'s current viewport.',
    `- The snapshot includes \`placement\`: current \`viewBox\`, whole-board \`contentBounds\`, existing \`occupiedFrames\`, and \`recommendedSlots\` for new ${targetFrameSize.width}x${targetFrameSize.height} ${placementFrameLabel}. Use it as the whiteboard map.`,
    '- Treat ALL visible snapshot shapes as occupied canvas content, not just `occupiedFrames`. `occupiedFrames` is a screen-frame shortcut; images, rects, groups, and text in the `shapes` list also reserve their x/y/w/h area.',
    codeCanvasMode
      ? '- If exactly one empty `frame` is selected and the user asks for a new UI frame/screen, use `design_create_screen` WITHOUT x/y/width/height; the renderer will reuse that selected frame instead of creating a loose frame elsewhere.'
      : '- If exactly one empty `frame` is selected and the user asks for a new page/screen, use `design_create_screen` WITHOUT x/y/width/height; the renderer will convert that selected canvas frame into the HTML screen instead of creating a loose screen elsewhere.',
    '- For `design_create_screen`, prefer omitting `x`/`y` so the system chooses the current empty viewport slot. If you must set explicit coordinates, copy a `placement.recommendedSlots[...]` rect or align deliberately with `placement.occupiedFrames`; do not invent far-off, negative, or overlapping coordinates.',
    codeCanvasMode
      ? '- Do not draw a style-kit board unless the user explicitly asks for a visual diagram of the design system.'
      : '- The project design-system board is a fixed file projection. Do not add, position, move, or recreate it with shape operations.',
    '- Refer to shapes by their `id` from the snapshot below. New shapes you add get auto-named uniquely per parent.',
    '- Prefer composing larger features as a frame containing children (use add for the frame, then add children with `parentId`); position each child within the frame’s absolute bounds.',
    '- Keep batches focused — one batch per logical change so undo granularity stays useful.',
    '- Arrows/lines/freehand: add `"type": "arrow"` (arrowhead at the last point), `"line"`, or `"draw"` and give `"points": [{ "x", "y" }, ...]` in ABSOLUTE canvas coords (≥2 points). The box is derived automatically — do not also set x/y/width/height.',
    '- Line styling: `strokes` carries color/width plus `"dash": "solid"|"dashed"|"dotted"`. Endpoint decorations via `"arrowheadStart"`/`"arrowheadEnd"`: "none"|"arrow"|"triangle"|"circle"|"bar"|"diamond".',
    '- Fill/stroke fields are STRICT objects — a partial fill like `{ "color": "#fff" }` is rejected and the WHOLE op is dropped. Always use the full shape: `"fills": [{ "type": "solid", "color": "#3b82d8", "opacity": 1 }]` and `"strokes": [{ "color": "#111827", "width": 1, "opacity": 1, "position": "inside" }]`. To reuse an existing color, read it from the snapshot.',
    '- `duplicate` is the right tool for repeated elements (cards, list rows, nav items): duplicate one well-made shape rather than re-adding it from scratch. Use `reorder` to fix overlap (bring a label to `front`, push a background `back`).',
    '- PREFER `auto-layout` over hand-computed coordinates for rows, columns, lists, nav bars, button groups, and stacked sections: add a frame, add the children with `parentId`, then `auto-layout` the frame — the children snap to an even gap/padding and re-flow whenever you add/remove/resize. This is the reliable way to get pixel-consistent spacing.',
    '- PREFER `set-style` when several shapes should share one look (same fill, the same card shadow, one type ramp). One `set-style` over many ids beats N separate `update` ops and keeps the design cohesive.',
    '- `group` related shapes so you can move/restyle/lay-out them as a unit; `asFrame: true` when the group also needs a background fill, clipping, or its own auto-layout.',
    '',
    'Placing a generated image on the canvas:',
    '- Call the `generate_image` tool to create the picture (pass an `aspect_ratio` matching the box you want).',
    '- For logo/icon/brand asset requests, generate a clean reusable asset first; prefer transparent or simple neutral backgrounds when the brief allows, so it can be selected and reused in later screen/page designs.',
    '- Read the saved file path from the tool result (`output.files[0].relativePath`, e.g. `.deepseekgui-images/img-….png`).',
    '- Then call `design_update_shapes` with an `add` op with `"type": "image"` and `"imageUrl": "<that relativePath>"` plus `x`/`y`/`width`/`height` for placement. The canvas renders the workspace file automatically.',
    '- To replace an existing image, `update` that shape\'s `imageUrl` instead of adding another.',
    '',
    'Filling a selected panel or an AI image holder (do this BEFORE scattering new image boxes):',
    '- Snapshot flags: `"selected": true` = the shape the user is pointing at ("here" / "this panel" / "这里" / "这个框"). `"aiImageHolder": true` = an image slot waiting to be filled — set automatically for any empty box (image with no picture, or a childless frame/rect) the user has selected, so they never need to mark it first.',
    '- Treat `"selected": true` as the highest-priority target for ambiguous wording like "this", "here", "这个", "这里", or "选中的".',
    '- When the user asks for an image and there is a selected holder (or a single selected `image`/`frame`), fill THAT shape instead of creating a loose new image:',
    '  • selected EMPTY `image` holder (no `imageUrl` field in the snapshot): `generate_image` with `aspect_ratio` ≈ its w:h, then `update` THAT shape — set `imageUrl` to the relativePath. Do NOT change its x/y/width/height; the picture fills the existing box exactly. If the selected `image` already carries an `imageUrl` in the snapshot, STOP — this is an EDIT, not a fill; jump to the "Editing or restyling an EXISTING image" section below and follow that rule instead.',
    '  • selected EMPTY `frame` or `rect` holder: `generate_image` with `aspect_ratio` ≈ its w:h, then `update` THAT SAME shape id — set `imageUrl` to the relativePath. Do NOT add a child image; the renderer converts the holder itself into a single image shape so the frame/image remain one selectable object with the original x/y/width/height.',
    '- If nothing is selected but the canvas has `aiImageHolder` shapes, fill the most relevant holder(s) the same way before adding brand-new image boxes.',
    '- Only `add` a free-floating new image box when there is no suitable selected target or holder.',
    '',
    'Editing or restyling an EXISTING image (image-to-image with a reference):',
    '- Trigger: the user asks to modify, edit, restyle, redo, transform, recolor, enhance, fix, or otherwise change a picture that is ALREADY in the canvas — including "change X into Y" / "把这张图改成…" / "改成 X" where the selected picture is the thing being changed — AND the snapshot shows the target `image` shape carries an `imageUrl` (a workspace-relative path like `.deepseekgui-images/…`). Selected `image` shapes with `imageUrl` are the primary target; same applies if the user names one by id/position. This is an image edit, NOT a request to build a new screen — do NOT call `design_create_screen` / `add-screen` and do NOT write HTML for it.',
    '- Implicit target via container: if the user selects a `frame` or `group` that contains EXACTLY ONE `image` child with an `imageUrl`, treat that child as the implicit edit target — use the child\'s `imageUrl` as the reference and `update` the child shape\'s `imageUrl` (do NOT add a new image, do NOT touch the parent frame\'s bounds). Two or more `image` children with `imageUrl` ⇒ ask the user which one (or apply the multi-reference clause below only if they explicitly asked to compose).',
    '- Action: call `generate_image` with `reference_image_paths: ["<that imageUrl exactly as it appears in the snapshot>"]` so the model edits the existing picture instead of inventing a fresh one. Keep `aspect_ratio` ≈ the shape\'s w:h. Then `update` THAT shape\'s `imageUrl` to the new `output.files[0].relativePath`; do NOT change its x/y/width/height.',
    '- Multiple selected images for a single composed result: pass each filled shape\'s `imageUrl` in `reference_image_paths` (cap at 4 — drop extras if there are more). The references are treated symmetrically by the model — compose freely from all of them and pick the most coherent result; the order in the array is not load-bearing. Then `update` the PRIMARY target shape\'s `imageUrl` with the new file (when the user named a specific shape, that one; otherwise the first filled `image` in the selection as it appears in the snapshot). Do not touch the other reference shapes unless the user asked you to.',
    '- Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder` (no `imageUrl` in the snapshot) or any empty `frame`/`rect` slot — those are fresh generations from text only. The empty-holder rule above still applies unchanged.',
    '- Before constructing `reference_image_paths`, locate each target shape in the snapshot by its `id` and copy its `imageUrl` verbatim. If the `imageUrl` field is absent on any target, drop that target from the array (do not guess or reconstruct a path from the shape name, position, or any other field).',
    '- Do NOT invent paths. If the target shape has no `imageUrl` field in the snapshot, treat it as empty and generate fresh.',
    '',
    ...formatDesignSystemLines(codeCanvasMode ? (options.canvasDesignSystem ?? null) : undefined),
    'Current canvas snapshot (shape ids, names, positions, graph summary, recent operation journal, bounded `motion` timelines/tracks/keyframes with stable ids and reduced-motion guidance, `codeBindings` for design-to-code anchors, `selected`/`inView`/`nearSelection`/`aiImageHolder` flags, `imageUrl` for filled image shapes, `tokenBindings` for token-bound props, sampled absolute `points` for arrows/lines/freehand with per-shape `pointsOmitted` when extra vertices were compacted, `placement` guide for viewBox/content bounds/occupied frames/recommended new-screen slots, plus a style digest — `fill`/`stroke` (color/width)/`fontColor`/`cornerRadius` — when set, so you can MATCH the existing palette instead of guessing; if `omitted` > 0 the view is truncated but selected, nearby, and viewport-visible shapes are prioritized):',
    '```json',
    snapshotJson,
    '```'
  ]
  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
  }
  // The canvas lane decides screen sizing, layout and shape styling, so it
  // inherits the same craft floor the HTML/screen lanes already get.
  lines.push('', ...DESIGN_CRAFT_LINES.slice(0, 5))
  const contextLocationLines = formatContextLocationLines(options.contextLocations)
  if (contextLocationLines.length > 0) {
    lines.push('', ...contextLocationLines)
  }
  const text = options.text?.trim()
  if (text) {
    lines.push('', 'Brief:', text.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  }
  lines.push('', 'Example response shape:')
  lines.push('I will add a 300x200 frame with a heading inside.')
  lines.push('Then call `design_update_shapes` with arguments:')
  lines.push('{')
  lines.push('  "ops": [')
  lines.push('    { "op": "add", "shape": { "type": "frame", "name": "Card", "x": 100, "y": 100, "width": 300, "height": 200 } }')
  lines.push('  ]')
  lines.push('}')
  return lines.join('\n')
}
