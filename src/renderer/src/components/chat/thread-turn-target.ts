import { codexReferenceRevision, sourceHistoryAllowed } from '../../history-reference/codex-reference-state'
import { create } from 'zustand'
import { useMemo } from 'react'
import type { ChatBlock, ThreadDetail } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { mergeChatBlocks } from '../../agent/kun-mapper'
import { orderSourceHistoryBlocks } from '../../agent/source-history-order'
import { useChatStore } from '../../store/chat-store'

export type ThreadTurnTarget = {
  threadId: string
  turnId: string
  itemId?: string
  blocks: ChatBlock[]
  historyTarget?: ThreadDetail['historyTarget']
  revision: number
}

export const useThreadTurnTarget = create<{ target: ThreadTurnTarget | null }>(() => ({ target: null }))
let revision = 0

export function blockContainsHistoryItem(block: ChatBlock, itemId: string): boolean {
  return block.id === itemId || block.sourceRecords?.some((record) => record.itemId === itemId) === true ||
    block.sourceItemId === itemId || (block.kind === 'tool' && block.meta?.sourceItemId === itemId)
}

export async function prepareThreadTurnTarget(threadId: string, turnId: string, itemId?: string): Promise<ThreadDetail> {
  const detail = await getProvider().getThreadDetail(threadId, {
    turnId, ...(itemId ? { itemId } : {}), priority: 'foreground'
  })
  if ((!/^(codex|claude-code):/u.test(turnId) && detail.latestTurnId !== turnId) ||
    !detail.blocks.some((block) => block.turnId === turnId && (!itemId || blockContainsHistoryItem(block, itemId)))) {
    throw new Error(`Requested turn history is unavailable: ${turnId}`)
  }
  return detail
}

export function activateThreadTurnTarget(threadId: string, turnId: string, detail: ThreadDetail, itemId?: string): void {
  if (/^(codex|claude-code):/u.test(turnId) && !sourceHistoryAllowed(turnId)) return
  useThreadTurnTarget.setState({ target: {
    threadId, turnId, itemId: itemId ?? detail.historyTarget?.itemId,
    blocks: detail.blocks.filter((block) => block.turnId === turnId),
    historyTarget: detail.historyTarget, revision: ++revision
  } })
}

export async function loadThreadTurnTargetPage(direction: 'previous' | 'next'): Promise<void> {
  const target = useThreadTurnTarget.getState().target
  const cursor = direction === 'previous' ? target?.historyTarget?.previousCursor : target?.historyTarget?.nextCursor
  if (!target || !cursor || !sourceHistoryAllowed(target.turnId)) return
  const historyRevision = codexReferenceRevision()
  const detail = await getProvider().getThreadDetail(target.threadId, {
    turnId: target.turnId, before: cursor, priority: 'foreground'
  })
  if (!sourceHistoryAllowed(target.turnId) || codexReferenceRevision() !== historyRevision ||
    useThreadTurnTarget.getState().target?.revision !== target.revision ||
    useChatStore.getState().activeThreadId !== target.threadId) return
  if (detail.historyTarget?.turnId !== target.turnId) throw new Error('Requested history page is unavailable')
  const blocks = mergeThreadTurnTarget(target.blocks, {
    ...target, blocks: detail.blocks.filter((block) => block.turnId === target.turnId)
  }, target.threadId)
  useThreadTurnTarget.setState({ target: { ...target, blocks, historyTarget: {
    ...target.historyTarget!,
    ...(direction === 'previous' ? { previousCursor: detail.historyTarget.previousCursor } : { nextCursor: detail.historyTarget.nextCursor })
  } } })
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
  if (/^(codex|claude-code):/u.test(target.turnId)) {
    // Existing pages define the fallback order for legacy sources. Explicit
    // source ordinals then place both overlaps and new records without relying
    // on identical per-turn timestamps. Native/SSE blocks retain their order.
    const loadedIds = new Set(blocks.map((block) => block.id))
    const source = orderSourceHistoryBlocks([
      ...blocks.filter((block) => /^(codex|claude-code):/u.test(block.turnId ?? '')).map((block) => ids.get(block.id)!),
      ...[...ids.values()].filter((block) => /^(codex|claude-code):/u.test(block.turnId ?? '') && !loadedIds.has(block.id))
    ])
    return [...new Map(source.map((block) => [block.id, block])).values(),
      ...[...ids.values()].filter((block) => !/^(codex|claude-code):/u.test(block.turnId ?? ''))]
  }
  const source = orderSourceHistoryBlocks([...ids.values()].filter((block) => /^(codex|claude-code):/u.test(block.turnId ?? '')))
  const native = [...ids.values()].filter((block) => !/^(codex|claude-code):/u.test(block.turnId ?? '')).sort((left, right) => {
    const a = Date.parse(left.createdAt ?? ''), b = Date.parse(right.createdAt ?? '')
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : 0
  })
  return [...source, ...native]
}

export function useTimelineTurnTargetBlocks(blocks: ChatBlock[], threadId: string | null): ChatBlock[] {
  const target = useThreadTurnTarget((state) => state.target)
  const assistantId = useChatStore((state) => state.activeThreadId === threadId ? state.liveAssistantItemId : undefined)
  const reasoningId = useChatStore((state) => state.activeThreadId === threadId ? state.liveReasoningItemId : undefined)
  return useMemo(() => mergeThreadTurnTarget(blocks, target, threadId, [assistantId, reasoningId]),
    [blocks, target, threadId, assistantId, reasoningId])
}
