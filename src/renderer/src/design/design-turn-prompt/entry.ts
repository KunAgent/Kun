import { WRITE_PROTOTYPE_DEFAULT_PROMPT, WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES,
  formatDesignContextLines
} from "../design-context"
import { formatDesignHtmlQualityFindings } from "../design-html-quality"
import type { DesignTurnOptions, ParallelDesignPagesPromptOptions, ScreenTurnOptions } from './shared'
import {
  formatDerivedTokenLines,
  formatContextLocationLines,
  formatDesignTargetFrameLines,
  formatScreenManifestLines
} from './shared'
import {
  buildCanvasTurnPrompt,
  buildScreenTurnPrompt,
  formatFrameContextLines,
  formatHtmlElementContextLines,
  formatHtmlIterationEditDisciplineLines,
  formatProjectDesignSystemLines
} from './html-and-canvas'
import { buildSvgTurnPrompt } from './svg'
import { formatExcalidrawScenePrompt } from '../../whiteboard/excalidraw-outbound'

export function buildParallelDesignPagesPrompt(options: ParallelDesignPagesPromptOptions): string {
  const jobs = options.jobs.filter((job) => job.artifactId.trim() && job.relativePath.trim())
  const lines = [
    'Kun is asking you to fan out a multi-page design build to subagents.',
    `Workspace: ${options.workspaceRoot}`,
    ...formatDesignTargetFrameLines(options.designContext),
    '',
    'Your job in THIS parent turn:',
    '- Do NOT write or edit files directly in the parent turn.',
    '- Call the `delegate_task` tool exactly once for every page job below.',
    '- IMPORTANT: issue all `delegate_task` calls in the SAME assistant message before waiting for results. Do not run them one-by-one; this is what makes the page generation parallel.',
    '- Use `profile: "general"` and `detach: false` for every call.',
    '- Use the exact label shown for each job (`page:<artifactId>`) so the design canvas can map child status back to that page.',
    '- Pass the child prompt for that job as the `prompt` argument. Each child prompt already restricts the child to its own HTML and DESIGN.md files.',
    '- After every child returns, summarize each page by artifact id and mention any failed child.',
    '',
    'Act as the design director for the fanout:',
    '- Every child page must feel like part of one product, not a gallery of unrelated mockups.',
    '- Reject generic page briefs in your child prompt mentally: push each child toward real content, concrete states, and a clear primary action.',
    '- Do not add extra pages, files, or follow-up tasks from the parent; the only parent output is the delegate_task batch plus the final status summary.',
    '',
    `Page jobs: ${jobs.length}`
  ]
  const projectBrief = options.projectBrief?.trim()
  if (projectBrief) {
    lines.push('', 'Overall project brief:', projectBrief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  }
  jobs.forEach((job, index) => {
    const childPrompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: job.brief,
      artifactRelativePath: job.relativePath,
      designNotesPath: job.designMdPath,
      workspaceRoot: options.workspaceRoot,
      ...(options.customPrompt ? { customPrompt: options.customPrompt } : {}),
      ...(options.designContext ? { designContext: options.designContext } : {}),
      ...(job.screenManifest.length > 0 ? { screenManifest: job.screenManifest } : {})
    })
    lines.push(
      '',
      `Job ${index + 1}: ${job.title}`,
      `- artifactId: ${job.artifactId}`,
      `- label: page:${job.artifactId}`,
      `- HTML file: ${job.relativePath}`,
      `- Design notes file: ${job.designMdPath}`,
      '- delegate_task arguments to use:',
      '```json',
      JSON.stringify(
        {
          label: `page:${job.artifactId}`,
          profile: 'general',
          detach: false,
          workspace: options.workspaceRoot,
          prompt: childPrompt
        },
        null,
        2
      ),
      '```'
    )
  })
  return lines.join('\n')
}

export function buildDesignTurnPrompt(options: DesignTurnOptions): string {
  if (options.target === 'canvas' && options.canvasEngine === 'excalidraw') {
    return formatExcalidrawScenePrompt(options.excalidrawScene)
  }
  if (options.target === 'canvas') {
    return buildCanvasTurnPrompt(options)
  }
  if (options.target === 'svg') {
    return buildSvgTurnPrompt(options)
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
    ...formatProjectDesignSystemLines(options),
    ...formatDesignTargetFrameLines(options.designContext),
    ...formatFrameContextLines(options.frameContext),
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
    '- If a canvas frame context is listed above, treat that width/height as the real webview viewport. Lay out the page to that viewport; content may scroll vertically when needed, but do not shrink the design to compensate for overflowing content.',
    ...DESIGN_RESIZE_RESPONSIVE_LINES,
    '- Build the complete document efficiently: prefer one coherent `write` when it fits the available tool limits; otherwise use a small bounded number of section-level `edit` calls. Do not fragment the page into dozens of micro-edits.',
    '- Write HTML ONLY through Write/Edit tool calls to the artifact file — never dump HTML into assistant text or into `design_canvas` blocks.',
    ...formatHtmlIterationEditDisciplineLines(options),
    ...(options.designNotesPath
      ? [
          `- Keep \`${options.designNotesPath}\` aligned with the final screen: brief, visual direction, interactions, assumptions, and handoff notes.`
        ]
      : []),
    '- The file content must be raw HTML — no markdown fences, no commentary inside the file.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed and the interactions you implemented.'
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
