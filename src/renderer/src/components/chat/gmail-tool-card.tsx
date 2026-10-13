import type { ToolPresentation } from '@shared/tool-presentation'
import { useState } from 'react'
import { GmailConnectionCard } from '../rooms/GmailConnectionCard'
import { gmailClient } from '../rooms/gmail-client'
import type { ChatBlock } from '../../agent/types'
import { readToolPresentation } from '../../agent/tool-presentation'

/** Only the native Gmail tool's typed marker can create a connection control. */
export function gmailToolThread(presentation: ToolPresentation): string | null {
  if (presentation.source !== 'native' || presentation.name !== 'gmail_connect' || presentation.kind === 'mcp' || presentation.server) return null
  const output = presentation.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const marker = (output as Record<string, unknown>).gmailConnection
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null
  const data = marker as Record<string, unknown>
  if (data.kind !== 'gmail' || data.status !== 'requested' || typeof data.threadId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(data.threadId) || data.scopeId !== `thread:${data.threadId}`) return null
  return data.threadId
}

export function GmailToolCard({ threadId, presentation }: { threadId: string; presentation?: ToolPresentation }) {
  const [continued, setContinued] = useState(false)
  const output = presentation?.output as { gmailConnection?: { sourceTurnId?: unknown; toolCallId?: unknown } } | undefined
  const marker = output?.gmailConnection
  const sourceTurnId = typeof marker?.sourceTurnId === 'string' && marker.sourceTurnId.length <= 256 ? marker.sourceTurnId : undefined
  const toolCallId = typeof marker?.toolCallId === 'string' && marker.toolCallId.length <= 256 ? marker.toolCallId : undefined
  const continueTask = sourceTurnId && toolCallId ? async () => {
    await gmailClient.continueTask(threadId, sourceTurnId, toolCallId)
    setContinued(true)
  } : undefined
  return <GmailConnectionCard binding={{ threadId }} resumed={continued} onContinue={continueTask} />
}

/** Connection controls remain actionable when the completed work trace is folded. */
export function GmailRequestedCards({ blocks }: { blocks: readonly ChatBlock[] }) {
  const seen = new Set<string>()
  const cards = [...blocks].reverse().flatMap((block) => {
    if (block.kind !== 'tool') return []
    const presentation = readToolPresentation(block)
    const threadId = gmailToolThread(presentation)
    if (!threadId || seen.has(threadId)) return []
    seen.add(threadId)
    return [{ blockId: block.id, threadId, presentation }]
  }).reverse()
  return <>{cards.map((card) => <GmailToolCard key={card.blockId} threadId={card.threadId} presentation={card.presentation} />)}</>
}
