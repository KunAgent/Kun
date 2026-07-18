import { describe, expect, it } from 'vitest'
import { makeAssistantTextItem, makeCompactionItem, makeUserItem } from '../domain/item.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory,
  placeCompactionsAtTurnEnd
} from './compaction-history.js'

describe('compaction history projection', () => {
  it('keeps the full visible transcript while projecting model history from the latest compaction', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_1'
    const headA = makeUserItem({ id: 'item_head_a', threadId, turnId, text: 'old user context' })
    const headB = makeAssistantTextItem({
      id: 'item_head_b',
      threadId,
      turnId,
      text: 'old assistant context',
      status: 'completed'
    })
    const previousSummary = makeCompactionItem({
      id: 'compaction_previous',
      threadId,
      turnId,
      summary: 'previous summary',
      replacedTokens: 100,
      pinnedConstraints: []
    })
    const tailA = makeUserItem({ id: 'item_tail_a', threadId, turnId, text: 'recent user context' })
    const tailB = makeAssistantTextItem({
      id: 'item_tail_b',
      threadId,
      turnId,
      text: 'recent assistant context',
      status: 'completed'
    })
    const nextSummary = makeCompactionItem({
      id: 'compaction_next',
      threadId,
      turnId,
      summary: 'next summary',
      replacedTokens: 200,
      pinnedConstraints: []
    })

    const visible = insertCompactionIntoVisibleHistory({
      visibleItems: [headA, headB, previousSummary, tailA, tailB],
      compactedItems: [nextSummary, tailA, tailB],
      summaryItem: nextSummary
    })

    expect(visible.map((item) => item.id)).toEqual([
      'item_head_a',
      'item_head_b',
      'compaction_next',
      'item_tail_a',
      'item_tail_b'
    ])
    expect(effectiveHistoryAfterLatestCompaction(visible).map((item) => item.id)).toEqual([
      'compaction_next',
      'item_tail_a',
      'item_tail_b'
    ])
  })

  it('preserves manual compaction markers when coalescing automatic markers', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_1'
    const manualSummary = makeCompactionItem({
      id: 'compaction_manual',
      threadId,
      turnId,
      summary: 'manual summary',
      replacedTokens: 100,
      pinnedConstraints: [],
      auto: false
    })
    const automaticSummary = makeCompactionItem({
      id: 'compaction_auto',
      threadId,
      turnId,
      summary: 'automatic summary',
      replacedTokens: 200,
      pinnedConstraints: [],
      auto: true
    })
    const tail = makeUserItem({ id: 'item_tail', threadId, turnId, text: 'recent' })

    const visible = insertCompactionIntoVisibleHistory({
      visibleItems: [manualSummary, tail],
      compactedItems: [automaticSummary, tail],
      summaryItem: automaticSummary
    })

    expect(visible.map((item) => item.id)).toEqual([
      'compaction_manual',
      'compaction_auto',
      'item_tail'
    ])
  })

  it('moves a turn-bucket compaction summary to the end so the UI renders it inside the latest turn', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_3'
    const userMessage = makeUserItem({ id: 'item_user_3', threadId, turnId, text: 'next request' })
    const summary = makeCompactionItem({
      id: 'compaction_for_turn_3',
      threadId,
      turnId,
      summary: 'fresh summary',
      replacedTokens: 200,
      pinnedConstraints: []
    })

    // Session-store insertion places the summary BEFORE the kept-verbatim tail
    // (`item_user_3` in this case) so the runtime's
    // `effectiveHistoryAfterLatestCompaction` returns `[summary, tail]`. When
    // that bucket is handed to the renderer, the summary must sit at the end —
    // otherwise `groupTurns` shoves it into the previous turn's process row.
    expect(
      placeCompactionsAtTurnEnd([summary, userMessage]).map((item) => item.id)
    ).toEqual(['item_user_3', 'compaction_for_turn_3'])
  })

  it('leaves buckets without a compaction summary untouched', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_1'
    const items = [
      makeUserItem({ id: 'item_user_1', threadId, turnId, text: 'first' }),
      makeAssistantTextItem({
        id: 'item_assistant_1',
        threadId,
        turnId,
        text: 'reply',
        status: 'completed'
      })
    ]
    expect(placeCompactionsAtTurnEnd(items).map((item) => item.id)).toEqual([
      'item_user_1',
      'item_assistant_1'
    ])
  })
})
