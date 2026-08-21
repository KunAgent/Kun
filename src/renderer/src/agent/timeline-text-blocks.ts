import type { ChatBlock } from './types'

type TimelineTextBlock = Extract<ChatBlock, { kind: 'assistant' | 'reasoning' }>

function isTimelineTextBlock(block: ChatBlock): block is TimelineTextBlock {
  return block.kind === 'assistant' || block.kind === 'reasoning'
}

/**
 * Reconcile repeated persisted snapshots without treating equal text from two
 * distinct runtime items as a duplicate. The first occurrence owns chronology;
 * the final snapshot owns the item content and terminal metadata.
 */
export function dedupeTimelineTextBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const deduped: ChatBlock[] = []
  const indexes = new Map<string, number>()
  let changed = false

  for (const block of blocks) {
    if (!isTimelineTextBlock(block)) {
      deduped.push(block)
      continue
    }
    const key = `${block.kind}:${block.id}`
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, deduped.length)
      deduped.push(block)
      continue
    }
    changed = true
    const existing = deduped[existingIndex]
    if (!existing || !isTimelineTextBlock(existing)) continue
    deduped[existingIndex] = {
      ...existing,
      ...block,
      turnId: block.turnId ?? existing.turnId,
      createdAt: block.createdAt ?? existing.createdAt,
      text: block.text || existing.text
    }
  }

  return changed ? deduped : blocks
}

export function isSyntheticTimelineTextBlock(block: ChatBlock): block is TimelineTextBlock {
  return isTimelineTextBlock(block) && (
    (block.kind === 'assistant' && /^a-\d+$/.test(block.id)) ||
    (block.kind === 'reasoning' && /^r-\d+$/.test(block.id))
  )
}
