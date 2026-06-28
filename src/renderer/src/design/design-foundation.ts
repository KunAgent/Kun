import { WRITE_PROTOTYPE_MAX_TEXT_CHARS } from '@shared/write-prototype'
import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'
import { DESIGN_PAGES_MAX, DESIGN_PAGES_MIN } from './design-pages'
import type { ScreenManifestEntry } from './design-turn-prompt'
import type { DesignArtifact } from './design-types'

/** Foundation role of a Stitch-style artifact (shared style guide / brand logo). */
export type DesignFoundationRole = NonNullable<DesignArtifact['role']>

/** Foundation step the orchestrator runs before any screen is generated. */
export type DesignFoundationStep = 'spec' | 'system' | 'logo'

/** Workspace-shared design-system token file (the contract design + code both read). */
export const DESIGN_SYSTEM_MD_PATH = '.kun-design/DESIGN_SYSTEM.md'

/** Per-设计稿 design brief (the project spec the foundation + pages all follow). */
export function designSpecPath(docId: string): string {
  return `.kun-design/${docId}/design.md`
}

/** First filled-role foundation artifact, if any (so re-runs reuse instead of duplicating). */
export function findFoundationArtifact(
  artifacts: DesignArtifact[],
  role: DesignFoundationRole
): DesignArtifact | undefined {
  return artifacts.find((artifact) => artifact.role === role)
}

/**
 * Placeholder `design.md` written before the spec turn so the file always exists
 * (the agent fleshes it out; later steps can read it even if the turn flakes).
 */
export function buildDesignSpecStub(brief: string): string {
  const trimmed = brief.trim().slice(0, 2000)
  return [
    '# Design brief',
    '',
    '> Draft — the design agent fills this in before any screen is built.',
    '',
    '## Brief',
    trimmed || '(describe the product here)',
    '',
    '## Concept & audience',
    '_TBD_',
    '',
    '## Visual direction',
    '_TBD_',
    '',
    '## Information architecture (pages)',
    '_TBD_',
    ''
  ].join('\n')
}

/**
 * Spec turn: lay the foundation BEFORE any screen. The agent writes the project
 * `design.md` (concept, audience, visual direction, information architecture)
 * and ends its reply with the same pages as a parseable ```pages JSON block —
 * folding design.md + the multi-page plan into one turn.
 */
export function buildDesignSpecPrompt(options: {
  brief: string
  workspaceRoot: string
  designMdPath: string
  designContext?: DesignContext
  existingPages?: ScreenManifestEntry[]
  maxPages?: number
}): string {
  const maxPages = Math.min(
    DESIGN_PAGES_MAX,
    Math.max(DESIGN_PAGES_MIN, options.maxPages ?? DESIGN_PAGES_MAX)
  )
  const lines = [
    'Kun is asking you to LAY THE FOUNDATION for a multi-page design before any screen is built.',
    `Workspace: ${options.workspaceRoot}`,
    `Design brief file (already created — fill it in): ${options.designMdPath}`,
    '',
    'Do TWO things this turn, in order:',
    `1) Write \`${options.designMdPath}\` as the project's design brief — the single source of truth the later steps follow. Cover: the product concept and who it is for; the visual direction (mood, the palette intent around the brand color, typography intent, layout & motion personality); and an "Information architecture" section listing the ${DESIGN_PAGES_MIN}-${maxPages} distinct pages with one line each. Make real decisions — no placeholders.`,
    `2) AFTER writing the file, end your reply with EXACTLY ONE fenced \`\`\`pages JSON array of those same pages. This is REQUIRED — the app parses it to scaffold the screens.`,
    '',
    'Rules:',
    `- Modify ONLY \`${options.designMdPath}\` this turn. Do NOT create HTML or any other file, and do NOT design screens yet.`,
    '- Each pages item is an object: { "title": "<short screen name ≤ 4 words>", "brief": "<self-contained paragraph: purpose, key sections, components, states>" }.',
    '- Order by importance (primary screen first). Cover only genuinely distinct screens; if it is truly one screen, return one.'
  ]
  if (options.existingPages && options.existingPages.length > 0) {
    lines.push(
      '',
      'Pages already on the canvas (do NOT duplicate — only plan NEW screens that are missing):',
      ...options.existingPages.map(
        (page) => `- "${page.name}"${page.summary ? ` — ${page.summary.slice(0, 120)}` : ''}`
      )
    )
  }
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  // A trimmed craft reminder so the brief already biases toward quality.
  lines.push('', ...DESIGN_CRAFT_LINES.slice(0, 4))
  const brief = options.brief.trim()
  if (brief) lines.push('', 'App idea:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  lines.push(
    '',
    'End your reply like:',
    '```pages',
    '[',
    '  { "title": "Home", "brief": "..." },',
    '  { "title": "Pricing", "brief": "..." }',
    ']',
    '```'
  )
  return lines.join('\n')
}

/**
 * Design-system turn: the visual style guide every page follows. The agent builds
 * a single-file HTML "board" (swatches, type specimen, components) AND writes the
 * shared `DESIGN_SYSTEM.md` with the SAME tokens as concrete values, so the canvas
 * and the real code read one source of truth.
 */
export function buildDesignSystemBoardPrompt(options: {
  brief: string
  workspaceRoot: string
  artifactRelativePath: string
  designSystemMdPath: string
  designMdPath?: string
  designContext?: DesignContext
}): string {
  const lines = [
    'Kun is asking you to design the VISUAL DESIGN SYSTEM for this product — the style guide every page will follow.',
    `Workspace: ${options.workspaceRoot}`,
    ...(options.designMdPath ? [`Design brief to honor: ${options.designMdPath} (read it first).`] : []),
    `Reserved style-guide file: ${options.artifactRelativePath}`,
    `Design-system token file: ${options.designSystemMdPath}`,
    '',
    `Produce a single-file interactive HTML "style guide" board at \`${options.artifactRelativePath}\` that VISUALLY specifies:`,
    '- Color: the brand/accent color, a real neutral ramp, plus semantic success / warning / danger — every swatch labeled with its #hex.',
    '- Typography: the font family and a type-scale specimen (display / heading / body / caption) with px / weight / line-height.',
    '- Spacing & radius: the spacing steps and corner-radius tokens shown as small visual chips.',
    '- Core components rendered for real: buttons (primary / secondary / ghost, with hover + disabled), an input, a card, a badge/tag, and one nav or header bar — so the language is concrete, not described.',
    '',
    'Hard rules:',
    `- Modify ONLY \`${options.artifactRelativePath}\` and \`${options.designSystemMdPath}\` this turn. Do not touch any other file.`,
    `- Also WRITE \`${options.designSystemMdPath}\` (Markdown) capturing the SAME tokens as concrete values — brand/accent #hex, the neutral ramp, semantic colors, font family + type scale, spacing steps, radius — and keep it in sync with the board.`,
    `- Produce ONE complete standalone HTML document at \`${options.artifactRelativePath}\`; it is pre-created so the canvas previews it while you work.`,
    '- Build it INCREMENTALLY to stay inside your output limit: focused `edit` calls or small `write` replacements, every tool payload under ~4000 characters.',
    '- The HTML file content must be raw HTML — no markdown fences, no commentary inside it.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary naming the accent #hex and the font.'
  ]
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  lines.push('', ...DESIGN_CRAFT_LINES)
  const brief = options.brief.trim()
  if (brief) lines.push('', 'Product:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  return lines.join('\n')
}

/**
 * Logo turn: the brand mark. The agent decides the medium by what fits the brand
 * — crisp inline SVG (preferred, recolorable) or a generated raster mark embedded
 * via <img> — and showcases it on an on-brand tile with a couple of variants.
 */
export function buildDesignLogoPrompt(options: {
  brief: string
  workspaceRoot: string
  artifactRelativePath: string
  designMdPath?: string
  designSystemMdPath?: string
  designContext?: DesignContext
}): string {
  const lines = [
    'Kun is asking you to design the BRAND LOGO for this product.',
    `Workspace: ${options.workspaceRoot}`,
    ...(options.designMdPath ? [`Design brief to honor: ${options.designMdPath}.`] : []),
    ...(options.designSystemMdPath
      ? [`Design system (palette / type): ${options.designSystemMdPath} — match it exactly.`]
      : []),
    `Reserved logo file: ${options.artifactRelativePath}`,
    '',
    `Produce a single-file HTML showcase of the logo at \`${options.artifactRelativePath}\`:`,
    '- The PRIMARY logo mark + wordmark, centered on an on-brand backdrop sized like a presentation tile.',
    '- Beneath it, a small horizontal lockup and a monochrome (single-color) variant.',
    '- You DECIDE the medium by what fits the brand: crisp inline SVG is preferred (vector, recolorable, sharp at any size). If a richer pictorial mark suits it better you MAY call the `generate_image` tool to create a raster mark and embed it via <img>.',
    '',
    'Hard rules:',
    `- Produce ONE standalone HTML document at \`${options.artifactRelativePath}\` (pre-created for live preview). If you generate a raster image, you may also save that image asset inside this artifact's folder and reference it.`,
    '- Build it INCREMENTALLY: every tool payload under ~4000 characters. Raw HTML only inside the file — no markdown fences.',
    '- Keep the logo legible at small sizes; honor the brand color; no purple→blue AI-default gradient.',
    '- Finish with the document ending in `</html>`, then reply with a one-paragraph note on the concept.'
  ]
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  const brief = options.brief.trim()
  if (brief) lines.push('', 'Product:', brief.slice(0, WRITE_PROTOTYPE_MAX_TEXT_CHARS))
  return lines.join('\n')
}

/**
 * The "follow the foundation" block prepended to every page brief: pointers to the
 * established `design.md` and `DESIGN_SYSTEM.md` so each page reuses the real spec
 * + tokens instead of re-inventing them. Returns `[]` when no foundation exists.
 */
export function buildFoundationFollowLines(options: {
  designMdPath?: string
  designSystemMdPath?: string
}): string[] {
  if (!options.designMdPath && !options.designSystemMdPath) return []
  const lines = ['Foundation already established for this product — FOLLOW it, do not reinvent:']
  if (options.designMdPath) {
    lines.push(`- Design brief: ${options.designMdPath} (concept, voice, information architecture).`)
  }
  if (options.designSystemMdPath) {
    lines.push(
      `- Design tokens: ${options.designSystemMdPath} — reuse the EXACT palette #hex, type scale, spacing and radius; do not invent new ones.`
    )
  }
  lines.push(
    '- The "Design system" style guide and the "Logo" are already on the canvas (see your siblings list) — match them exactly.'
  )
  return lines
}
