import type { WriteRetrievalContext } from '@shared/write-retrieval'

/**
 * Snippets from the space related to a Work turn. The open document is only
 * searched while it is part of the turn's context.
 */
export async function retrieveWorkbenchWriteContext(input: {
  workspaceRoot: string
  currentFilePath: string | null
  query: string
  includeCurrentFile: boolean
}): Promise<WriteRetrievalContext | null> {
  const query = input.query.trim()
  if (!query || typeof window.kunGui?.retrieveWriteContext !== 'function') return null
  try {
    const result = await window.kunGui.retrieveWriteContext({
      workspaceRoot: input.workspaceRoot,
      currentFilePath: input.currentFilePath ?? undefined,
      query,
      maxSnippets: 4,
      includeCurrentFile: input.includeCurrentFile
    })
    return result.ok ? result.context : null
  } catch (error) {
    void window.kunGui?.logError?.('write-retrieval', 'Failed to retrieve write context', {
      message: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
