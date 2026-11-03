import type { ChatBlock, ToolBlock } from '../../agent/types'
import { isFastContextToolBlock } from './fast-context-card-copy'
import { parseExploreBatchChildren } from './subagent-call-card-support'

/** Splits one aggregate explore result into a block per child so each gets its own card. */
export function expandExploreBatchBlock(block: ChatBlock): ChatBlock[] {
  if (block.kind !== 'tool' || !isFastContextToolBlock(block as ToolBlock)) return [block]
  const tool = block as ToolBlock
  const children = parseExploreBatchChildren(tool.detail)
  if (children.length === 0) return [block]
  return children.map((child) => ({
    ...tool,
    id: `${tool.id}:explore:${child.index}`,
    summary: child.title,
    status: child.status === 'completed'
      ? 'success'
      : child.status === 'failed' || child.status === 'aborted'
        ? 'error'
        : 'running',
    detail: JSON.stringify({
      ...child,
      ...(typeof child.totalTokens === 'number'
        ? { usage: { totalTokens: child.totalTokens } }
        : {})
    }),
    meta: {
      ...tool.meta,
      toolName: 'fast_context',
      child: {
        childId: child.childId,
        childLabel: child.title,
        childProfile: 'explore',
        childProfileName: child.profileName,
        childModel: child.model,
        childStatus: child.status,
        childSeq: child.index,
        parentTurnId: tool.turnId,
        toolInvocations: child.toolInvocations,
        attemptStartedAt: child.attemptStartedAt,
        attemptDurationMs: child.attemptDurationMs,
        durationMs: child.durationMs,
        totalTokens: child.totalTokens
      }
    }
  }))
}
