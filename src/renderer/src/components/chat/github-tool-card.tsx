import type { ToolPresentation } from '@shared/tool-presentation'
import { useState } from 'react'
import { GitHubConnectionCard } from '../rooms/GitHubConnectionCard'
import { githubAppClient } from '../rooms/github-app-client'
import type { ChatBlock } from '../../agent/types'
import { readToolPresentation } from '../../agent/tool-presentation'

/** Only the native GitHub tool's typed marker can create a connection control. */
export function githubToolThread(presentation: ToolPresentation): string | null {
  if (presentation.source !== 'native' || presentation.name !== 'github_connect' || presentation.kind === 'mcp' || presentation.server) return null
  const output = presentation.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const marker = (output as Record<string, unknown>).githubConnection
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null
  const data = marker as Record<string, unknown>
  if (data.kind !== 'github' || data.status !== 'requested' || typeof data.threadId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(data.threadId) || data.scopeId !== `thread:${data.threadId}`) return null
  return data.threadId
}

export function GitHubToolCard({ threadId, presentation }: { threadId: string; presentation?: ToolPresentation }) {
  const [continued, setContinued] = useState(false)
  const output = presentation?.output as { githubConnection?: { sourceTurnId?: unknown; toolCallId?: unknown } } | undefined
  const marker = output?.githubConnection
  const sourceTurnId = typeof marker?.sourceTurnId === 'string' && marker.sourceTurnId.length <= 256 ? marker.sourceTurnId : undefined
  const toolCallId = typeof marker?.toolCallId === 'string' && marker.toolCallId.length <= 256 ? marker.toolCallId : undefined
  const continueTask = sourceTurnId && toolCallId ? async () => {
    const result = await githubAppClient.continueTask(threadId, sourceTurnId, toolCallId)
    if (result.pending) return false
    setContinued(true)
    return true
  } : undefined
  return <GitHubConnectionCard binding={{ threadId }} resumed={continued} onContinue={continueTask} />
}

/** Connection controls remain actionable when the completed work trace is folded. */
export function GitHubRequestedCards({ blocks }: { blocks: readonly ChatBlock[] }) {
  const seen = new Set<string>()
  const cards = [...blocks].reverse().flatMap((block) => {
    if (block.kind !== 'tool') return []
    const presentation = readToolPresentation(block)
    const threadId = githubToolThread(presentation)
    if (!threadId || seen.has(threadId)) return []
    seen.add(threadId)
    return [{ blockId: block.id, threadId, presentation }]
  }).reverse()
  return <>{cards.map((card) => <GitHubToolCard key={card.blockId} threadId={card.threadId} presentation={card.presentation} />)}</>
}
