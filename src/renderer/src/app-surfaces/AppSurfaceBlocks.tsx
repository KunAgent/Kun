import type { ReactElement } from 'react'
import type { ToolBlock } from '../agent/types'
import { genUiRefFromBlock, mcpAppFromBlock } from './app-surface-tool-meta'
import { GenUiCard } from './gen-ui/GenUiCard'
import { McpAppCard } from './mcp-apps/McpAppCard'

/**
 * Interactive pages produced by a turn: Gen UI widgets (`render_widget`) and
 * MCP App pages of tools that declared a `ui://` resource. Rendered after the
 * assistant's conclusion, like other conversation visualizations.
 */
export function AppSurfaceBlocks({
  threadId,
  blocks
}: {
  threadId: string | null | undefined
  blocks: readonly ToolBlock[]
}): ReactElement | null {
  if (!threadId || blocks.length === 0) return null
  return (
    <>
      {blocks.map((block) => {
        const widget = genUiRefFromBlock(block)
        if (widget) return <GenUiCard key={block.id} threadId={threadId} widget={widget} />
        if (mcpAppFromBlock(block)) {
          return <McpAppCard key={block.id} threadId={threadId} block={block} />
        }
        return null
      })}
    </>
  )
}
