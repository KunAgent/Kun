/**
 * Tools whose results carry PPT whiteboard bundles. `ppt_preview` and
 * `ppt_export` come from the slides skill; `ppt_agent` stays readable so
 * boards from older conversations still replay.
 */
const PPT_BOARD_TOOL_NAMES: ReadonlySet<string> = new Set(['ppt_preview', 'ppt_export', 'ppt_agent'])

export function isPptBoardToolName(name: unknown): boolean {
  return typeof name === 'string' && PPT_BOARD_TOOL_NAMES.has(name.trim())
}

/** The workspace-relative .pptx a PPT tool result published, when it passed validation. */
export function pptToolOutputPath(toolName: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (toolName === 'ppt_export') {
    return payload.validated === true && typeof payload.output === 'string' && payload.output.trim()
      ? payload.output.trim()
      : undefined
  }
  const deckArtifact = payload.deckArtifact
  if (!deckArtifact || typeof deckArtifact !== 'object' || Array.isArray(deckArtifact)) return undefined
  const output = (deckArtifact as Record<string, unknown>).output
  return typeof output === 'string' && output.trim() ? output.trim() : undefined
}
