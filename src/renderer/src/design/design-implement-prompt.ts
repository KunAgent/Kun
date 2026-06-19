import { DESIGN_CRAFT_LINES, formatDesignContextLines, type DesignContext } from './design-context'

export type ImplementDesignOptions = {
  artifactTitle: string
  /** Workspace-relative path to the approved design's single-file HTML. */
  artifactRelativePath: string
  /** Workspace-relative path to the published design system, if any. */
  designSystemRelativePath?: string
  /** Target stack hint, e.g. "React + Tailwind + shadcn"; empty = auto-detect. */
  stackHint?: string
  /** Reference the published design system in the prompt. */
  referenceDesignSystem?: boolean
  workspaceRoot: string
  designContext?: DesignContext
}

/**
 * Code-turn prompt that hands an approved design artifact to the coding agent to
 * implement in the REAL project. The design HTML is the visual contract; the
 * agent expresses it idiomatically in the project's actual stack rather than
 * pasting the mockup verbatim. This is the design→code spine.
 */
export function buildImplementDesignPrompt(options: ImplementDesignOptions): string {
  const lines = [
    `Implement the approved design "${options.artifactTitle}" in this project.`,
    `Workspace: ${options.workspaceRoot}`,
    `Design source (a standalone HTML mockup): ${options.artifactRelativePath}`,
    options.referenceDesignSystem && options.designSystemRelativePath
      ? `Project design system: ${options.designSystemRelativePath}`
      : '',
    '',
    'How to proceed:',
    `- First read \`${options.artifactRelativePath}\` to understand its layout, components, states and interactions.`,
    options.stackHint?.trim()
      ? `- Target stack: ${options.stackHint.trim()}. Use it; only deviate if the project clearly uses something else.`
      : "- Detect this project's stack (framework, styling, component library) from its files and config; do NOT introduce a new stack or dependency unless necessary.",
    '- Reuse existing components, design tokens and conventions where they exist; only create new ones when needed.',
    "- Reproduce the design's structure and visual intent faithfully — it is the visual contract — but express it idiomatically in the project's real code, not by pasting the mockup's inline HTML/CSS verbatim.",
    '- Wire up the implied interactions and states.',
    '- When done, summarize which files you created or changed and any follow-ups.'
  ].filter(Boolean)
  const contextLines = formatDesignContextLines(options.designContext)
  if (contextLines.length > 0) lines.push('', ...contextLines)
  lines.push('', ...DESIGN_CRAFT_LINES)
  return lines.join('\n')
}
