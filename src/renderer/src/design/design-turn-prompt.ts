import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'
import type { CanvasSnapshot } from './canvas/canvas-snapshot'
import { snapshotToCompactJson } from './canvas/canvas-snapshot'
import type { OpError } from './canvas/shape-ops'
import { useDesignSystemStore } from './canvas/design-system-store'
import type { DesignToken } from './canvas/design-system-types'
import { takeLastLintFindings } from './canvas/design-lint'
import type { DerivedTokens } from './design-token-extract'
import type { DesignContextLocation, DesignHtmlElementContext } from './design-composer-context'

/**
 * Render the design tokens already extracted from the live design (palette +
 * type scale) as a concrete reuse contract. Cohesion across pages was relying on
 * the model reading sibling HTML; handing it the actual `#hex` accent and type
 * scale to match is far stronger and stops palettes drifting between iterations.
 */
export function formatDerivedTokenLines(tokens: DerivedTokens | undefined): string[] {
  if (!tokens) return []
  const colorParts: string[] = []
  if (tokens.palette.primary?.base) colorParts.push(`accent ${tokens.palette.primary.base}`)
  if (tokens.palette.secondary?.base) colorParts.push(`secondary ${tokens.palette.secondary.base}`)
  if (tokens.palette.neutral?.base) colorParts.push(`neutral ${tokens.palette.neutral.base}`)
  const typeParts = tokens.typeRows.slice(0, 4).map((r) => `${r.label} ${Math.round(r.px)}/${r.fontWeight}`)
  const fontFamily = tokens.typeRows.find((r) => r.fontFamily)?.fontFamily?.split(',')[0]?.trim()
  if (colorParts.length === 0 && typeParts.length === 0) return []
  const lines = ['Existing design tokens to REUSE exactly (keep this cohesive with the rest of the product):']
  if (colorParts.length > 0) lines.push(`- Palette: ${colorParts.join(', ')}`)
  if (typeParts.length > 0) {
    lines.push(`- Type scale: ${typeParts.join(', ')}${fontFamily ? ` — font ${fontFamily}` : ''}`)
  }
  lines.push('')
  return lines
}

export type DesignTurnTarget = 'html' | 'canvas' | 'screen'

export type DesignTurnOptions = {
  target: DesignTurnTarget
  mode: 'text' | 'image'
  /** Free-form description of the design to produce (text mode). */
  text?: string
  /** Workspace-relative path the agent must write the artifact to. */
  artifactRelativePath: string
  /** Workspace-relative per-artifact design notes file the agent may update. */
  designNotesPath?: string
  /** Prior version to iterate on; set = update that design instead of starting fresh. */
  basePath?: string
  /** HTML preview element selected by the user for this turn. */
  htmlElementContext?: DesignHtmlElementContext
  workspaceRoot: string
  /** User override prompt; empty = built-in default. */
  customPrompt?: string
  designContext?: DesignContext
  /** Canvas mode only: current snapshot of the shape document for AI reasoning. */
  canvasSnapshot?: CanvasSnapshot
  /**
   * Sibling pages already on the project canvas. Passed so a generated/iterated
   * page stays visually consistent with the rest of the project (shared palette,
   * typography, spacing) — the cohesion half of the Stitch-style multi-page model.
   */
  screenManifest?: ScreenManifestEntry[]
  /**
   * Lightweight pointers to the design artifacts the user has selected on the
   * canvas/board (HTML page, SVG canvas, image). We pass each one's file path +
   * directory — NOT the inlined content — so the agent reads them on demand
   * instead of us bloating the turn with full HTML/JSON.
   */
  contextLocations?: DesignContextLocation[]
  /**
   * Errors from the PREVIOUS canvas turn's ops (bad shape id, schema-invalid op,
   * missing parent) so the agent can self-correct. Rendered near the top of the
   * canvas prompt; the apply hook stashes them and the next canvas turn takes them.
   */
  previousOpErrors?: OpError[]
  /**
   * Tokens extracted from the page being iterated (or the project's anchor page)
   * so an HTML/screen turn reuses the real palette/type scale instead of
   * re-inventing one and drifting from the rest of the product.
   */
  derivedTokens?: DerivedTokens
}

/**
 * Render the "the user is pointing at these" block: a short list of selected
 * artifact paths + directories. The agent reads them on demand — we deliberately
 * do NOT inline HTML/JSON so the turn stays small.
 */
function formatContextLocationLines(locations: DesignContextLocation[] | undefined): string[] {
  if (!locations || locations.length === 0) return []
  const seen = new Set<string>()
  const rows: string[] = []
  for (const loc of locations) {
    const path = loc.path.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    const title = loc.title.trim() || path
    rows.push(`- ${title} [${loc.kind}] → \`${path}\` (directory: \`${loc.directory}\`)`)
  }
  if (rows.length === 0) return []
  return [
    'Selected on the canvas (the user is pointing at these). Read the listed file(s) only if you need their current content — do not assume their contents, and do not inline them wholesale:',
    ...rows
  ]
}

/**
 * Turn prompt for the design agent: produce a single-file interactive HTML
 * artifact saved to the exact reserved path. Generalizes
 * `buildSddPrototypeTurnPrompt` (drops the SDD-requirement framing) while
 * keeping the single-file / incremental-write / <4000-char-per-tool-call
 * contract the webview embed + path polling rely on.
 *
 * Single target today; the P2 (`'graph'`) / P3 (`'penpot'`) phases add a
 * `switch (options.target)` branch here without touching the HTML path.
 */
export type ScreenManifestEntry = {
  name: string
  /** Canvas placement size in px; omitted for free-flow HTML pages. */
  width?: number
  height?: number
  htmlPath: string
  /** One-line brief of what the page is, so the agent can align without reading it. */
  summary?: string
  /** Sibling's actual accent color (hex), extracted from its render, for cohesion. */
  accent?: string
  /** Sibling's primary font family, extracted from its render, for cohesion. */
  fontFamily?: string
}

/**
 * Render the "other pages in this project" block shared by the HTML and screen
 * turn prompts. Lets a generated/iterated page align with its siblings.
 */
function formatScreenManifestLines(manifest: ScreenManifestEntry[] | undefined): string[] {
  if (!manifest || manifest.length === 0) return []
  return [
    'Other pages already in this project (keep ONE cohesive design system across them — shared palette, typography, spacing, components):',
    ...manifest.map((s) => {
      const dims = typeof s.width === 'number' && typeof s.height === 'number'
        ? ` (${Math.round(s.width)}x${Math.round(s.height)})`
        : ''
      const tokenParts = [
        s.accent ? `accent ${s.accent}` : '',
        s.fontFamily ? `font ${s.fontFamily}` : ''
      ].filter(Boolean)
      const tokens = tokenParts.length > 0 ? ` [${tokenParts.join(', ')}]` : ''
      const summary = s.summary?.trim() ? ` — ${s.summary.trim().slice(0, 160)}` : ''
      return `- "${s.name}"${dims}${tokens} → ${s.htmlPath}${summary}`
    }),
    'Read a relevant sibling page if you need to match its exact styling. Do NOT modify sibling files — only the reserved file for this turn.'
  ]
}

export type ScreenTurnOptions = DesignTurnOptions & {
  screenName: string
  screenWidth?: number
  screenHeight?: number
  screenManifest: ScreenManifestEntry[]
}

export function buildDesignTurnPrompt(options: DesignTurnOptions): string {
  if (options.target === 'canvas') {
    return buildCanvasTurnPrompt(options)
  }
  if (options.target === 'screen') {
    return buildScreenTurnPrompt(options as ScreenTurnOptions)
  }
  const requirements = options.customPrompt?.trim() || WRITE_PROTOTYPE_DEFAULT_PROMPT
  const editableFiles = options.designNotesPath
    ? `\`${options.artifactRelativePath}\` and \`${options.designNotesPath}\``
    : `\`${options.artifactRelativePath}\``
  const lines = [
    options.basePath
      ? 'Kun is asking you to ITERATE on an existing single-file HTML design.'
      : 'Kun is asking you to design a single-file interactive HTML artifact.',
    `Workspace: ${options.workspaceRoot}`,
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
    '- Make the HTML responsive to arbitrary canvas frame sizes: use fluid layout, min/max constraints, media queries, and avoid fixed viewport wrappers unless the brief explicitly asks for one.',
    '- Build it INCREMENTALLY to stay inside your output limit: use focused `edit` calls or small `write` replacements and keep every tool call payload under ~4000 characters — oversized tool arguments get truncated and fail.',
    ...(options.designNotesPath
      ? [
          `- Keep \`${options.designNotesPath}\` aligned with the final screen: brief, visual direction, interactions, assumptions, and handoff notes.`
        ]
      : []),
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed and the interactions you implemented.'
  ]
  const manifestLines = formatScreenManifestLines(options.screenManifest)
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
  lines.push(...formatDerivedTokenLines(options.derivedTokens))
  lines.push('', ...DESIGN_CRAFT_LINES)
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

/**
 * Screen-target turn prompt: generate HTML for a specific screen frame on the
 * canvas. Combines the HTML generation rules with cross-screen context so the AI
 * can maintain visual consistency across screens (shared palette, typography, etc.)
 */
function buildScreenTurnPrompt(options: ScreenTurnOptions): string {
  const requirements = options.customPrompt?.trim() || WRITE_PROTOTYPE_DEFAULT_PROMPT
  const editableFiles = options.designNotesPath
    ? `\`${options.artifactRelativePath}\` and \`${options.designNotesPath}\``
    : `\`${options.artifactRelativePath}\``
  const lines = [
    options.basePath
      ? `Kun is asking you to ITERATE on an existing screen design: "${options.screenName}".`
      : `Kun is asking you to design a new screen: "${options.screenName}".`,
    `Workspace: ${options.workspaceRoot}`,
    ...(typeof options.screenWidth === 'number' && typeof options.screenHeight === 'number'
      ? [`Selected screen frame: ${Math.round(options.screenWidth)}x${Math.round(options.screenHeight)} canvas pixels.`]
      : []),
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
    '- Build it INCREMENTALLY to stay inside your output limit: use focused `edit` calls or small `write` replacements and keep every tool call payload under ~4000 characters.',
    ...(options.designNotesPath
      ? [
          `- Keep \`${options.designNotesPath}\` aligned with this screen: brief, selected frame, visual direction, interactions, assumptions, and handoff notes.`
        ]
      : []),
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed.'
  ]

  const manifestLines = formatScreenManifestLines(options.screenManifest)
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
  lines.push(...formatDerivedTokenLines(options.derivedTokens))
  lines.push('', ...DESIGN_CRAFT_LINES)
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

function formatHtmlElementContextLines(element: DesignHtmlElementContext | undefined): string[] {
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

function formatPreviousOpErrorLines(errors: OpError[] | undefined): string[] {
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

function summarizeToken(t: DesignToken): string {
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
function formatDesignSystemLines(): string[] {
  const { system } = useDesignSystemStore.getState()
  const tokens = Object.values(system.tokens)
  const components = Object.values(system.components)
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
function formatLintFindingsLines(): string[] {
  const findings = takeLastLintFindings()
  if (findings.length === 0) return []
  return [
    `Design-system lint flagged ${findings.length} issue(s) from your last lint-design-system run — fix these (apply-token / set-style / resize / bulk-edit) before adding more:`,
    ...findings.slice(0, 20).map((f) => `- [${f.code}]${f.shapeId ? ` (${f.shapeId})` : ''} ${f.message}`),
    ''
  ]
}

function buildCanvasTurnPrompt(options: DesignTurnOptions): string {
  const snapshot = options.canvasSnapshot
  const snapshotJson = snapshot ? snapshotToCompactJson(snapshot) : '(empty canvas)'
  const errorLines = formatPreviousOpErrorLines(options.previousOpErrors)
  const editHint = deriveSelectedImageEditHint(snapshot)
  const editHintLines = editHint
    ? [
        `IMPORTANT PRIOR — the user has EXACTLY ONE filled image selected (id "${editHint.id}", imageUrl \`${editHint.imageUrl}\`). Unless they EXPLICITLY ask for a NEW page / screen / 页面, this is the EDIT AN EXISTING IMAGE lane: call generate_image with reference_image_paths: ["${editHint.imageUrl}"], then update_shapes that SAME shape's imageUrl. Do NOT add_screen / add-screen and do NOT write or edit HTML.`,
        ''
      ]
    : []
  const selectionLines = formatSelectedShapesLines(snapshot)
  const lines = [
    'Kun is asking you to operate the design canvas by calling the `design_canvas` tool.',
    `Workspace: ${options.workspaceRoot}`,
    '',
    ...errorLines,
    ...formatLintFindingsLines(),
    ...editHintLines,
    ...selectionLines,
    'How to respond:',
    '- Reply with a short plain-text plan (1-3 sentences) describing what you will do.',
    '- Then emit one or more ` ```design_canvas ` fenced JSON tool-call blocks. Do not ask the user to manually create a canvas first.',
    '- The renderer validates each tool call, applies it atomically (one undo entry per call), and visually highlights the affected shapes for ~1s.',
    '- RENDER LIVE: each block is executed the INSTANT you close its ``` fence — not at the end of your reply. So emit MANY focused calls progressively as you build (a frame, then its children, then the next section), instead of one giant batch. Keep them flowing so the user watches the design materialize piece by piece. Never bundle the whole design into a single block — stream it.',
    '- You can drive several parts of the layout in the same turn: fire successive `design_canvas` calls back to back (each lands immediately), so independent sections of the draft fill in one after another without waiting for a round trip.',
    '',
    'FIRST classify the request and commit to ONE lane (do not mix lanes):',
    '- EDIT AN EXISTING IMAGE — the user wants to change/edit/restyle/redo/recolor/fix/transform a picture that is ALREADY on the canvas, and the snapshot has a SELECTED `image` shape carrying an `imageUrl`. Phrasings like "change X into Y", "把这张图改成…", "改成 X", or "改一下这张图" all land here when the selected picture is the thing being changed. → call `generate_image` with `reference_image_paths` set to that `imageUrl`, then `update_shapes` that same shape (full rules under "Editing or restyling an EXISTING image" below). In this lane you MUST NOT use `add_screen` / `add-screen` and MUST NOT write or edit any HTML file.',
    '- FILL AN EMPTY SLOT — a selected empty holder / frame / rect (no `imageUrl`) needs a fresh picture. → `generate_image` from text only, then place it (see "Filling a selected panel" below).',
    '- BUILD OR REDESIGN A SCREEN — the user wants a new page / screen / UI mockup ("做个页面", "设计一个…", "基于这张图做个落地页"). → call `design_canvas` with `action: "add_screen"`; the system generates its HTML afterwards. A selected image in this lane is only a visual reference — do NOT overwrite it.',
    '- EDIT THE CANVAS — add, move, align, restyle, group, or annotate shapes. → use the structural ops below.',
    'When a filled `image` is selected and the verb is change/edit-like, choose EDIT AN EXISTING IMAGE over BUILD OR REDESIGN A SCREEN.',
    '',
    '`design_canvas` tool-call schema:',
    '- { "action": "create_board", "title"? }  // optional; the app keeps one active board per design document',
    '- { "action": "add_screen", "name": "Screen Name", "brief"?, "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" }  // creates a screen frame; the system auto-generates its HTML content afterwards',
    '- { "action": "update_shapes", "ops": [ ShapeOp, ... ] }  // edits vector layers/images on the active board',
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
    '- { "op": "add-screen", "name": "Screen Name", "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" }  // legacy alias accepted inside `update_shapes`; prefer `action: "add_screen"`',
    '',
    'Design-system ops (use these for cohesion + batch — they make "change the brand color" or "12 identical cards" one call instead of N edits):',
    '- { "op": "define-token", "name": "brand/primary", "kind": "color"|"gradient"|"type"|"space"|"radius"|"shadow", "value": <by kind> }  // color: "#3b82d8"; gradient: a full gradient fill; type: { fontSize?, fontWeight?, fontFamily?, lineHeight?, textAlign?, fontColor? }; space/radius: a number; shadow: a shadows array. Redefining an existing token re-flows every shape bound to it.',
    '- { "op": "apply-token", "ids": ["<id>",...], "prop": "fill"|"stroke"|"text-color"|"font"|"radius"|"shadow"|"gap"|"padding", "token": "brand/primary" }  // binds the shapes to the token (so a later define-token edit updates them). Prefer this over hardcoding a hex you used elsewhere.',
    '- { "op": "define-component", "name": "ProductCard", "fromId": "<shape-id>", "slots": [{ "path": "<descendant shape name>", "kind": "text"|"image"|"color"|"visible" }] }  // turn a well-made shape/subtree into a reusable component; `slots` name the parts each instance can override (matched by the descendant\'s name).',
    '- { "op": "instantiate", "name": "ProductCard", "at": { "x": N, "y": N }, "parentId"?, "overrides"?: { "<slot name>": <value> } }  // stamp one instance; overrides feed the slots (text→textContent, image→imageUrl, color→hex fill, visible→bool).',
    '- { "op": "instantiate-many", "name": "ProductCard", "data": [ { "<slot>": <value> }, ... ], "layout": { "kind": "grid"|"row"|"column", "cols"?: N, "gap"?: N }, "at"?: { "x": N, "y": N }, "parentId"? }  // BATCH: one instance per data row, auto-placed on a grid. Use this for card walls / lists / repeated rows instead of N add ops.',
    '- { "op": "update-component", "name": "ProductCard", "fromId": "<edited shape-id>" }  // re-snapshot the master from an edited instance/subtree; every other instance re-flows, keeping its own overrides.',
    '- { "op": "detach", "id": "<instance root id>" }  // cut an instance loose from its component so it can diverge freely.',
    '- { "op": "add-screens", "specs": [ { "name": "Home", "brief"?, "devicePreset"?, "x"?, "y"? }, ... ] }  // BATCH: create several screen frames in one call (auto-arranged in a row); each gets its HTML generated afterwards.',
    '- { "op": "bulk-edit", "filter": { "type"?, "nameContains"?, "boundToken"?, "component"?, "inFrame"? }, "set": { ...style fields... } }  // restyle every shape matching the filter in one call (e.g. round all buttons, recolor every ProductCard).',
    '- { "op": "grid", "id": "<frame/group id>", "cols": N, "rowGap"?, "colGap"? }  // arrange a container’s existing children on a grid (cell = largest child).',
    '- { "op": "stack", "ids": ["<id>",...], "direction": "horizontal"|"vertical", "gap"?, "name"?, "asFrame"?: true }  // wrap loose shapes into one auto-layout container (group + auto-layout in a single step).',
    '- { "op": "responsive-reflow", "frameId": "<id>", "device": "mobile"|"tablet"|"desktop" }  // resize a frame to a device preset and re-flow constrained children.',
    '- { "op": "apply-theme", "ids": ["<id>",...], "remap": { "<oldToken>": "<newToken>" } }  // re-skin a subtree by rebinding its token-bound props to themed tokens (e.g. light→dark). Define both token sets first.',
    '- { "op": "recolor", "ids": ["<id>",...], "mapping": { "<oldHex>": "<newHex>" } }  // swap exact colors across a subtree (escape hatch for un-tokenized art).',
    '- { "op": "variant-matrix", "baseId": "<id>", "devices"?: ["mobile","desktop"], "themes"?: [ { "name": "dark", "remap": { "<oldToken>": "<newToken>" } } ], "gap"?, "at"? }  // BATCH: tile clones of a base across device × theme cells, each reflowed + themed. The flagship "show it everywhere" op.',
    '- { "op": "lint-design-system" }  // self-check the design for off-token colors, low text contrast, and sub-44px tap targets. Findings surface at the top of your NEXT turn — fix them there. Run this after a big batch.',
    '',
    'Styling vocabulary:',
    '- Solid fill: `{ "type": "solid", "color": "#3b82d8", "opacity": 1 }`. Gradient fill: `{ "type": "linear", "angle": 90, "stops": [{ "offset": 0, "color": "#6366f1" }, { "offset": 1, "color": "#8b5cf6" }], "opacity": 1 }` (or `"type": "radial"`, no angle). `angle` is degrees clockwise: 0 = left→right, 90 = top→bottom.',
    '- Shadows: `"shadows": [{ "x": 0, "y": 4, "blur": 12, "color": "#0f172a", "opacity": 0.18 }]` for elevation (use `"type": "inner"` for inset). Stack multiple for layered depth. Reuse one elevation across a set of cards via `set-style`.',
    '- `blendMode`: any CSS mix-blend-mode ("multiply", "screen", "overlay", …) for compositing.',
    '',
    'Rules:',
    '- Use `add_screen` ONLY when the user actually wants a new page / screen (the BUILD OR REDESIGN A SCREEN lane). If a filled `image` is selected and the user asked to change / edit / restyle it, do NOT `add_screen` / `add-screen` — edit that image instead. `add_screen` only creates the frame placeholder; the system will AUTOMATICALLY generate the HTML content for the screen in a follow-up step. Do NOT call write/edit tools to create HTML files in this turn.',
    '- Coordinates are in CANVAS pixels (not screen pixels); 1 unit ≈ 1px at 100% zoom.',
    '- ALL coordinates are ABSOLUTE — including shapes inside a frame or group. `parentId` sets logical grouping only; it does NOT offset coordinates. To place a child at the top-left of a frame at (200, 100), give the child x≈200, y≈100 (not 0, 0). The snapshot positions below are likewise absolute.',
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
    '- Read the saved file path from the tool result (`output.files[0].relativePath`, e.g. `.deepseekgui-images/img-….png`).',
    '- Then call `design_canvas` with `action: "update_shapes"` and an `add` op with `"type": "image"` and `"imageUrl": "<that relativePath>"` plus `x`/`y`/`width`/`height` for placement. The canvas renders the workspace file automatically.',
    '- To replace an existing image, `update` that shape\'s `imageUrl` instead of adding another.',
    '',
    'Filling a selected panel or an AI image holder (do this BEFORE scattering new image boxes):',
    '- Snapshot flags: `"selected": true` = the shape the user is pointing at ("here" / "this panel" / "这里" / "这个框"). `"aiImageHolder": true` = an image slot waiting to be filled — set automatically for any empty box (image with no picture, or a childless frame/rect) the user has selected, so they never need to mark it first.',
    '- Treat `"selected": true` as the highest-priority target for ambiguous wording like "this", "here", "这个", "这里", or "选中的".',
    '- When the user asks for an image and there is a selected holder (or a single selected `image`/`frame`), fill THAT shape instead of creating a loose new image:',
    '  • selected EMPTY `image` holder (no `imageUrl` field in the snapshot): `generate_image` with `aspect_ratio` ≈ its w:h, then `update` THAT shape — set `imageUrl` to the relativePath. Do NOT change its x/y/width/height; the picture fills the existing box exactly. If the selected `image` already carries an `imageUrl` in the snapshot, STOP — this is an EDIT, not a fill; jump to the "Editing or restyling an EXISTING image" section below and follow that rule instead.',
    '  • selected `frame` (or a `frame` holder): `generate_image`, then `add` an `image` with `parentId` = the frame id and the SAME x/y/width/height as the frame (child coords are ABSOLUTE canvas coords). The image then lives inside the panel and moves with it.',
    '  • selected `rect` (or a `rect` holder): `generate_image`, then `add` an `image` with the SAME x/y/width/height as the rect (no `parentId`) so the picture covers the box exactly.',
    '- If nothing is selected but the canvas has `aiImageHolder` shapes, fill the most relevant holder(s) the same way before adding brand-new image boxes.',
    '- Only `add` a free-floating new image box when there is no suitable selected target or holder.',
    '',
    'Editing or restyling an EXISTING image (image-to-image with a reference):',
    '- Trigger: the user asks to modify, edit, restyle, redo, transform, recolor, enhance, fix, or otherwise change a picture that is ALREADY in the canvas — including "change X into Y" / "把这张图改成…" / "改成 X" where the selected picture is the thing being changed — AND the snapshot shows the target `image` shape carries an `imageUrl` (a workspace-relative path like `.deepseekgui-images/…`). Selected `image` shapes with `imageUrl` are the primary target; same applies if the user names one by id/position. This is an image edit, NOT a request to build a new screen — do NOT `add_screen` / `add-screen` and do NOT write HTML for it.',
    '- Implicit target via container: if the user selects a `frame` or `group` that contains EXACTLY ONE `image` child with an `imageUrl`, treat that child as the implicit edit target — use the child\'s `imageUrl` as the reference and `update` the child shape\'s `imageUrl` (do NOT add a new image, do NOT touch the parent frame\'s bounds). Two or more `image` children with `imageUrl` ⇒ ask the user which one (or apply the multi-reference clause below only if they explicitly asked to compose).',
    '- Action: call `generate_image` with `reference_image_paths: ["<that imageUrl exactly as it appears in the snapshot>"]` so the model edits the existing picture instead of inventing a fresh one. Keep `aspect_ratio` ≈ the shape\'s w:h. Then `update` THAT shape\'s `imageUrl` to the new `output.files[0].relativePath`; do NOT change its x/y/width/height.',
    '- Multiple selected images for a single composed result: pass each filled shape\'s `imageUrl` in `reference_image_paths` (cap at 4 — drop extras if there are more). The references are treated symmetrically by the model — compose freely from all of them and pick the most coherent result; the order in the array is not load-bearing. Then `update` the PRIMARY target shape\'s `imageUrl` with the new file (when the user named a specific shape, that one; otherwise the first filled `image` in the selection as it appears in the snapshot). Do not touch the other reference shapes unless the user asked you to.',
    '- Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder` (no `imageUrl` in the snapshot) or any empty `frame`/`rect` slot — those are fresh generations from text only. The empty-holder rule above still applies unchanged.',
    '- Before constructing `reference_image_paths`, locate each target shape in the snapshot by its `id` and copy its `imageUrl` verbatim. If the `imageUrl` field is absent on any target, drop that target from the array (do not guess or reconstruct a path from the shape name, position, or any other field).',
    '- Do NOT invent paths. If the target shape has no `imageUrl` field in the snapshot, treat it as empty and generate fresh.',
    '',
    ...formatDesignSystemLines(),
    'Current canvas snapshot (shape ids, names, positions, `selected`/`aiImageHolder` flags, `imageUrl` for filled image shapes, `tokenBindings` for token-bound props, plus a style digest — `fill`/`stroke` (color/width)/`fontColor`/`cornerRadius` — when set, so you can MATCH the existing palette instead of guessing; if `omitted` > 0 the view is truncated — focus a frame to see the rest):',
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
  lines.push('```')
  lines.push('I will add a 300×200 frame with a heading inside.')
  lines.push('```design_canvas')
  lines.push('{')
  lines.push('  "action": "update_shapes",')
  lines.push('  "ops": [')
  lines.push('    { "op": "add", "shape": { "type": "frame", "name": "Card", "x": 100, "y": 100, "width": 300, "height": 200 } }')
  lines.push('  ]')
  lines.push('}')
  lines.push('```')
  lines.push('```')
  return lines.join('\n')
}

/**
 * Code-mode entry point for the canvas ShapeOps turn prompt. Same instructions
 * the design canvas uses, minus the design-artifact framing — the code chat
 * agent reads it (gated on the canvas panel being open) to drive the canvas.
 */
export function buildCodeCanvasTurnPrompt(options: {
  workspaceRoot: string
  canvasSnapshot?: CanvasSnapshot
}): string {
  return buildCanvasTurnPrompt({
    target: 'canvas',
    mode: 'text',
    artifactRelativePath: '',
    workspaceRoot: options.workspaceRoot,
    ...(options.canvasSnapshot ? { canvasSnapshot: options.canvasSnapshot } : {})
  })
}

export type DesignImageNodeOptions = {
  text?: string
  /** Workspace-relative .png path the node's image must end up at. */
  outputRelativePath: string
  workspaceRoot: string
  designContext?: DesignContext
}

/**
 * Image node (node canvas): generate an image with the generate_image tool and
 * land it at the exact reserved .png path so the canvas can display it.
 */
export function buildDesignImageNodePrompt(options: DesignImageNodeOptions): string {
  const lines = [
    'Kun is asking you to generate an IMAGE for a design node.',
    `Workspace: ${options.workspaceRoot}`,
    `Reserved output file: ${options.outputRelativePath}`,
    '',
    'How to proceed:',
    '- Use the generate_image tool to create the image from the brief below.',
    `- The tool saves to its own location; then save or copy the result to the EXACT path \`${options.outputRelativePath}\` (create parent directories as needed) so the canvas can display it.`,
    '- Do not modify any other file.',
    '- Reply with a one-paragraph description of the image you generated.'
  ]
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  const text = options.text?.trim()
  if (text) lines.push('', 'Brief:', text.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  return lines.join('\n')
}

export type DesignFromCodeOptions = {
  /** Workspace-relative (or absolute) path to the existing UI code to reverse-design. */
  sourceRelativePath: string
  artifactRelativePath: string
  workspaceRoot: string
  designContext?: DesignContext
  derivedTokens?: DerivedTokens
}

/**
 * Code → design: produce an HTML design exploration from existing UI code. The
 * agent reads the real component and renders a clean, iterable design of what it
 * produces — the reverse of buildImplementDesignPrompt, closing the round trip.
 */
export function buildDesignFromCodePrompt(options: DesignFromCodeOptions): string {
  const lines = [
    'Kun is asking you to produce a design exploration based on existing code.',
    `Workspace: ${options.workspaceRoot}`,
    `Source UI code: ${options.sourceRelativePath}`,
    `Reserved artifact file: ${options.artifactRelativePath}`,
    '',
    'How to proceed:',
    `- Read \`${options.sourceRelativePath}\` (and the components/styles it imports) to understand what it renders — layout, components, states, interactions.`,
    `- Produce ONE complete standalone HTML document at \`${options.artifactRelativePath}\` that faithfully reproduces what that code renders, as a clean design you can iterate on. Inline all CSS/JS; never reference local files.`,
    '- Build it incrementally: write a small valid skeleton first, then extend with edit calls. Keep every tool call payload under ~4000 characters.',
    '- Do NOT modify the source code or any other file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary.'
  ]
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  lines.push(...formatDerivedTokenLines(options.derivedTokens))
  lines.push('', ...DESIGN_CRAFT_LINES)
  return lines.join('\n')
}
