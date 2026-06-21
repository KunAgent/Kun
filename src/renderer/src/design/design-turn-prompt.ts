import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'
import type { CanvasSnapshot } from './canvas/canvas-snapshot'
import { snapshotToCompactJson } from './canvas/canvas-snapshot'
import type { DesignHtmlElementContext } from './design-composer-context'

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
  width: number
  height: number
  htmlPath: string
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
  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
  }
  const htmlElementLines = formatHtmlElementContextLines(options.htmlElementContext)
  if (htmlElementLines.length > 0) {
    lines.push('', ...htmlElementLines)
  }
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

  if (options.screenManifest.length > 0) {
    lines.push(
      '',
      'Other screens in the same project (maintain visual consistency — shared palette, typography, spacing):',
      ...options.screenManifest.map(
        (s) => `- "${s.name}" (${s.width}x${s.height}) → ${s.htmlPath}`
      ),
      'Read relevant sibling screens if you need to align with their styling.'
    )
  }

  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
  }
  const htmlElementLines = formatHtmlElementContextLines(options.htmlElementContext)
  if (htmlElementLines.length > 0) {
    lines.push('', ...htmlElementLines)
  }
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
 * Canvas-target turn prompt: teach the AI to emit ShapeOps inside a fenced
 * `shapeops` code block. The renderer parses these blocks and runs them through
 * `executeOps`, which atomically applies the batch with a single undo entry.
 *
 * Keep the schema documentation here in sync with `shape-ops.ts` ShapeOpSchema.
 */
function buildCanvasTurnPrompt(options: DesignTurnOptions): string {
  const snapshot = options.canvasSnapshot
  const snapshotJson = snapshot ? snapshotToCompactJson(snapshot) : '(empty canvas)'
  const lines = [
    'Kun is asking you to modify the SVG design canvas using structured ShapeOps.',
    `Workspace: ${options.workspaceRoot}`,
    '',
    'How to respond:',
    '- Reply with a short plain-text plan (1-3 sentences) describing what you will do.',
    '- Emit one or more ` ```shapeops ` fenced code blocks containing a JSON ARRAY of operations.',
    '- The renderer will validate the JSON, apply every op atomically (one undo entry per batch),',
    '  and visually highlight the affected shapes for ~1s.',
    '',
    'ShapeOp vocabulary (each op is a JSON object inside the array):',
    '- { "op": "add", "shape": { "type": "rect"|"ellipse"|"text"|"frame"|"group"|"image"|"arrow"|"line"|"draw", "name"?, "x"?, "y"?, "width"?, "height"?, "rotation"?, "fills"?, "strokes"?, "cornerRadius"?, "textContent"?, "fontSize"?, "fontFamily"?, "fontColor"?, "imageUrl"?, "points"?, "arrowheadStart"?, "arrowheadEnd"? }, "parentId"? }',
    '- { "op": "update", "id": "<shape-id>", "patch": { ...same fields as shape (no type)... } }',
    '- { "op": "delete", "id": "<shape-id>" }',
    '- { "op": "reparent", "id": "<shape-id>", "newParentId": "<parent-id>", "index"? }',
    '- { "op": "move", "ids": ["<id>",...], "dx": N, "dy": N }',
    '- { "op": "resize", "id": "<shape-id>", "bounds": { "x": N, "y": N, "width": N, "height": N } }',
    '- { "op": "align", "ids": ["<id>",...], "axis": "left|h-center|right|top|v-center|bottom" }  // ≥2 ids',
    '- { "op": "distribute", "ids": ["<id>",...], "axis": "horizontal|vertical" }  // ≥3 ids',
    '- { "op": "add-screen", "name": "Screen Name", "x"?, "y"?, "width"?, "height"?, "devicePreset"?: "mobile"|"tablet"|"desktop" }  // creates an empty screen frame; the system auto-generates its HTML content afterwards — do NOT write any HTML files yourself',
    '',
    'Rules:',
    '- `add-screen` only creates the frame placeholder. The system will AUTOMATICALLY generate the HTML content for the screen in a follow-up step. Do NOT call write/edit tools to create HTML files in this turn.',
    '- Coordinates are in CANVAS pixels (not screen pixels); 1 unit ≈ 1px at 100% zoom.',
    '- ALL coordinates are ABSOLUTE — including shapes inside a frame or group. `parentId` sets logical grouping only; it does NOT offset coordinates. To place a child at the top-left of a frame at (200, 100), give the child x≈200, y≈100 (not 0, 0). The snapshot positions below are likewise absolute.',
    '- Refer to shapes by their `id` from the snapshot below. New shapes you add get auto-named uniquely per parent.',
    '- Prefer composing larger features as a frame containing children (use add for the frame, then add children with `parentId`); position each child within the frame’s absolute bounds.',
    '- Keep batches focused — one batch per logical change so undo granularity stays useful.',
    '- Arrows/lines/freehand: add `"type": "arrow"` (arrowhead at the last point), `"line"`, or `"draw"` and give `"points": [{ "x", "y" }, ...]` in ABSOLUTE canvas coords (≥2 points). The box is derived automatically — do not also set x/y/width/height.',
    '- Line styling: `strokes` carries color/width plus `"dash": "solid"|"dashed"|"dotted"`. Endpoint decorations via `"arrowheadStart"`/`"arrowheadEnd"`: "none"|"arrow"|"triangle"|"circle"|"bar"|"diamond".',
    '',
    'Placing a generated image on the canvas:',
    '- Call the `generate_image` tool to create the picture (pass an `aspect_ratio` matching the box you want).',
    '- Read the saved file path from the tool result (`output.files[0].relativePath`, e.g. `.deepseekgui-images/img-….png`).',
    '- Then emit an `add` op with `"type": "image"` and `"imageUrl": "<that relativePath>"` plus `x`/`y`/`width`/`height` for placement. The canvas renders the workspace file automatically.',
    '- To replace an existing image, `update` that shape\'s `imageUrl` instead of adding another.',
    '',
    'Filling a selected panel or an AI image holder (do this BEFORE scattering new image boxes):',
    '- Snapshot flags: `"selected": true` = the shape the user is pointing at ("here" / "this panel" / "这里" / "这个框"). `"aiImageHolder": true` = an empty slot explicitly waiting to be filled.',
    '- Treat `"selected": true` as the highest-priority target for ambiguous wording like "this", "here", "这个", "这里", or "选中的".',
    '- When the user asks for an image and there is a selected holder (or a single selected `image`/`frame`), fill THAT shape instead of creating a loose new image:',
    '  • selected `image` (or an `image` holder): `generate_image` with `aspect_ratio` ≈ its w:h, then `update` THAT shape — set `imageUrl` to the relativePath. Do NOT change its x/y/width/height; the picture fills the existing box exactly.',
    '  • selected `frame` (or a `frame` holder): `generate_image`, then `add` an `image` with `parentId` = the frame id and the SAME x/y/width/height as the frame (child coords are ABSOLUTE canvas coords). The image then lives inside the panel and moves with it.',
    '- If nothing is selected but the canvas has `aiImageHolder` shapes, fill the most relevant holder(s) the same way before adding brand-new image boxes.',
    '- Only `add` a free-floating new image box when there is no suitable selected target or holder.',
    '',
    'Current canvas snapshot (shape ids, names, positions, `selected`/`aiImageHolder` flags; rendering details omitted):',
    '```json',
    snapshotJson,
    '```'
  ]
  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
  }
  const text = options.text?.trim()
  if (text) {
    lines.push('', 'Brief:', text.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  }
  lines.push('', 'Example response shape:')
  lines.push('```')
  lines.push('I will add a 300×200 frame with a heading inside.')
  lines.push('```shapeops')
  lines.push('[')
  lines.push('  { "op": "add", "shape": { "type": "frame", "name": "Card", "x": 100, "y": 100, "width": 300, "height": 200 } }')
  lines.push(']')
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
  lines.push('', ...DESIGN_CRAFT_LINES)
  return lines.join('\n')
}
