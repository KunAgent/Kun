import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'

/** Generation target. P2 adds `'graph'` (node canvas), P3 adds `'penpot'`. */
export type DesignTurnTarget = 'html'

export type DesignTurnOptions = {
  target: DesignTurnTarget
  mode: 'text' | 'image'
  /** Free-form description of the design to produce (text mode). */
  text?: string
  /** Workspace-relative path the agent must write the artifact to. */
  artifactRelativePath: string
  /** Prior version to iterate on; set = update that design instead of starting fresh. */
  basePath?: string
  workspaceRoot: string
  /** User override prompt; empty = built-in default. */
  customPrompt?: string
  designContext?: DesignContext
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
export function buildDesignTurnPrompt(options: DesignTurnOptions): string {
  const requirements = options.customPrompt?.trim() || WRITE_PROTOTYPE_DEFAULT_PROMPT
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
    '',
    `Design requirements: ${requirements}`,
    '',
    'Hard rules:',
    `- Produce ONE complete standalone HTML document at \`${options.artifactRelativePath}\`; create parent directories as needed.`,
    '- Build it INCREMENTALLY to stay inside your output limit: first `write` a small valid skeleton (doctype, head, empty body), then extend it with several `edit` calls. Keep every tool call payload under ~4000 characters — oversized tool arguments get truncated and fail.',
    '- Do not create or modify any other file during this turn.',
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed and the interactions you implemented.'
  ]
  const designContextLines = formatDesignContextLines(options.designContext)
  if (designContextLines.length > 0) {
    lines.push('', ...designContextLines)
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
