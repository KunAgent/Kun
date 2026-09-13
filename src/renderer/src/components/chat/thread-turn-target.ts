import { sourceHistoryAllowed } from '../../history-reference/codex-reference-state'
import { create } from 'zustand'
import { useMemo } from 'react'
import type { ChatBlock, ThreadDetail } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { mergeChatBlocks } from '../../agent/kun-mapper'
import { useChatStore } from '../../store/chat-store'

export type ThreadTurnTarget = {
  threadId: string
  turnId: string
  blocks: ChatBlock[]
  revision: number
}

export const useThreadTurnTarget = create<{ target: ThreadTurnTarget | null }>(() => ({ target: null }))
let revision = 0

export async function prepareThreadTurnTarget(threadId: string, turnId: string): Promise<ThreadDetail> {
  const detail = await getProvider().getThreadDetail(threadId, { turnId, priority: 'foreground' })
  if (detail.latestTurnId !== turnId || !detail.blocks.some((block) => block.turnId === turnId)) {
    throw new Error(`Requested turn history is unavailable: ${turnId}`)
  }
  return detail
}

export function activateThreadTurnTarget(threadId: string, turnId: string, detail: ThreadDetail): void {
  if (turnId.startsWith('codex:') && !sourceHistoryAllowed()) return
  useThreadTurnTarget.setState({ target: {
    threadId, turnId, blocks: detail.blocks.filter((block) => block.turnId === turnId), revision: ++revision
  } })
}

/** Merge a bounded historical segment for display; never replace live store state. */
export function mergeThreadTurnTarget(
  blocks: ChatBlock[], target: ThreadTurnTarget | null, threadId: string | null,
  liveItemIds: readonly (string | undefined)[] = []
): ChatBlock[] {
  if (!target || target.threadId !== threadId) return blocks
  const merged = mergeChatBlocks([...target.blocks.filter((block) => !liveItemIds.includes(block.id)), ...blocks])
  const ids = new Map<string, ChatBlock>()
  for (const block of merged) ids.set(block.id, block)
  return [...ids.values()].sort((left, right) => {
    const a = Date.parse(left.createdAt ?? ''), b = Date.parse(right.createdAt ?? '')
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : 0
  })
}

export function useTimelineTurnTargetBlocks(blocks: ChatBlock[], threadId: string | null): ChatBlock[] {
  const target = useThreadTurnTarget((state) => state.target)
  const assistantId = useChatStore((state) => state.activeThreadId === threadId ? state.liveAssistantItemId : undefined)
  const reasoningId = useChatStore((state) => state.activeThreadId === threadId ? state.liveReasoningItemId : undefined)
  return useMemo(() => mergeThreadTurnTarget(blocks, target, threadId, [assistantId, reasoningId]),
    [blocks, target, threadId, assistantId, reasoningId])
}
