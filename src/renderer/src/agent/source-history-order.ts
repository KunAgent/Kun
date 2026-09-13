import type { ChatBlock, SourceHistoryOrder } from './types'

export function compareSourceHistoryOrder(left: SourceHistoryOrder | undefined, right: SourceHistoryOrder | undefined): number {
  if (!left || !right || left.referenceId !== right.referenceId) return 0
  return left.turnIndex - right.turnIndex || left.itemIndex - right.itemIndex
}

export function earliestSourceHistoryOrder(left: SourceHistoryOrder | undefined, right: SourceHistoryOrder | undefined): SourceHistoryOrder | undefined {
  if (!left) return right
  if (!right || left.referenceId !== right.referenceId) return left
  return compareSourceHistoryOrder(left, right) <= 0 ? left : right
}

/** Only source slots are reordered. Native and live events retain their sequence. */
export function orderSourceHistoryBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const source = blocks.filter((block) => /^(codex|claude-code):/u.test(block.turnId ?? ''))
  if (source.length < 2) return blocks
  source.sort((left, right) => {
    if (left.sourceHistoryOrder && right.sourceHistoryOrder &&
      left.sourceHistoryOrder.referenceId === right.sourceHistoryOrder.referenceId) {
      return compareSourceHistoryOrder(left.sourceHistoryOrder, right.sourceHistoryOrder)
    }
    // Older runtimes lack the order metadata: retain loaded-page order for ties.
    // Record IDs are opaque and must never be ordered lexicographically.
    const a = Date.parse(left.createdAt ?? ''), b = Date.parse(right.createdAt ?? '')
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : 0
  })
  let index = 0
  return blocks.map((block) => /^(codex|claude-code):/u.test(block.turnId ?? '') ? source[index++]! : block)
}
