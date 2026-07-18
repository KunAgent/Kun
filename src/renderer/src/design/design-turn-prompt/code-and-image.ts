import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import {
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
import { takeLastLintFindings } from "../canvas/design-lint"
import type { DesignContextLocation, DesignHtmlElementContext } from "../design-composer-context"
import { formatDesignHtmlQualityFindings, type DesignHtmlQualityFinding } from "../design-html-quality"
import { formatDesignTargetAssetLines } from './shared'
import { buildCanvasTurnPrompt } from './html-and-canvas'

/**
 * Code-mode entry point for the canvas ShapeOps turn prompt. It uses the same
 * tool vocabulary as Design mode, but screen ops are explicitly framed as
 * editable whiteboard frames rather than HTML artifacts.
 */
export function buildCodeCanvasTurnPrompt(options: {
  workspaceRoot: string
  text?: string
  canvasSnapshot?: CanvasSnapshot
  designContext?: DesignContext
  previousOpErrors?: OpError[]
  canvasFeedbackKey?: string
  canvasDesignSystem?: DesignSystem
}): string {
  const base = buildCanvasTurnPrompt({
    target: 'canvas',
    mode: 'text',
    ...(options.text ? { text: options.text } : {}),
    artifactRelativePath: '',
    workspaceRoot: options.workspaceRoot,
    canvasSurface: 'code',
    ...(options.designContext ? { designContext: options.designContext } : {}),
    ...(options.canvasSnapshot ? { canvasSnapshot: options.canvasSnapshot } : {}),
    ...(options.previousOpErrors ? { previousOpErrors: options.previousOpErrors } : {}),
    ...(options.canvasFeedbackKey ? { canvasFeedbackKey: options.canvasFeedbackKey } : {}),
    ...(options.canvasDesignSystem ? { canvasDesignSystem: options.canvasDesignSystem } : {})
  })
  return [
    base,
    '',
    'Code-mode whiteboard override:',
    '- This is the Code sidebar whiteboard, not Design mode. `design_create_screen` / `add-screen` creates plain editable frame shapes here; it does NOT trigger follow-up HTML screen generation.',
    '- For architecture maps, flows, notes, diagrams, image slots, and UI sketches, prefer `design_update_shapes` with normal frame/rect/text/arrow/image ops.',
    '- Build architecture diagrams from editable rounded rect/frame nodes (usually 12-16px radius), short text labels, and arrow connectors. Use a restrained palette, consistent 2px strokes, clear hierarchy, and generous spacing; avoid stacking loose text over unlabeled boxes.',
    '- If the user explicitly asks for an image, PNG, SVG, export, or file copy of the diagram, call `design_export_canvas` directly when the current snapshot already contains it; otherwise create/update the editable shapes first and then export (default PNG). This produces a real workspace file and conversation preview; do not call `generate_image` to redraw or rasterize the architecture diagram.',
    '- If the user asks only for an editable diagram, do not export automatically. Briefly tell them it is open in the whiteboard and can also be exported later from the toolbar.'
  ].join('\n')
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
    ...formatDesignTargetAssetLines(options.designContext),
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
