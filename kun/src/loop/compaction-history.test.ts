import { describe, expect, it } from 'vitest'
import {
  makeAssistantTextItem,
  makeCompactionItem,
  makeGoalContextItem,
  makeUserItem
} from '../domain/item.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory,
  placeCompactionsChronologically
} from './compaction-history.js'
import { makeInternalTurnRuntimeContextSource } from '../domain/internal-turn-runtime-context.js'

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

  it('moves internal goal context after a new summary without replaying folded history', () => {
    const threadId = 'thread_goal_context'
    const turnId = 'turn_goal_context'
    const head = makeUserItem({ id: 'goal_head', threadId, turnId, text: 'old context' })
    const goal = makeGoalContextItem({
      id: 'goal_context',
      threadId,
      turnId,
      text: 'Durable goal context.',
      createdAt: '2026-08-06T00:00:00.000Z'
    })
    const folded = makeAssistantTextItem({
      id: 'goal_folded',
      threadId,
      turnId,
      text: 'old progress',
      status: 'completed'
    })
    const tail = makeUserItem({ id: 'goal_tail', threadId, turnId, text: 'recent context' })
    const summary = makeCompactionItem({
      id: 'goal_summary',
      threadId,
      turnId,
      summary: 'summary of old context',
      replacedTokens: 100,
      pinnedConstraints: []
    })

    const visible = insertCompactionIntoVisibleHistory({
      visibleItems: [head, goal, folded, tail],
      compactedItems: [summary, goal, tail],
      summaryItem: summary
    })

    expect(visible.map((item) => item.id)).toEqual([
      head.id,
      folded.id,
      summary.id,
      goal.id,
      tail.id
    ])
    expect(effectiveHistoryAfterLatestCompaction(visible).map((item) => item.id)).toEqual([
      summary.id,
      goal.id,
      tail.id
    ])
  })

  it('keeps a private runtime context source after compaction', () => {
    const threadId = 'thread_host_context'
    const turnId = 'turn_host_context'
    const head = makeUserItem({ id: 'host_head', threadId, turnId, text: 'old context' })
    const source = makeInternalTurnRuntimeContextSource({
      threadId,
      turnId,
      context: { kind: 'host-control', content: 'private workflow control' },
      createdAt: '2026-08-13T00:00:00.000Z'
    })
    const tail = makeUserItem({ id: 'host_tail', threadId, turnId, text: 'current request' })
    const summary = makeCompactionItem({
      id: 'host_summary', threadId, turnId, summary: 'earlier work',
      replacedTokens: 100, pinnedConstraints: []
    })
    const visible = insertCompactionIntoVisibleHistory({
      visibleItems: [head, source, tail],
      compactedItems: [summary, source, tail],
      summaryItem: summary
    })
    expect(effectiveHistoryAfterLatestCompaction(visible).map((item) => item.id)).toEqual([
      summary.id, source.id, tail.id
    ])
  })

  it('replaces the previous marker when a new canonical summary lands in the same window', () => {
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
      'compaction_auto',
      'item_tail'
    ])
  })

  it('places a turn-bucket compaction summary between work that happened before and after it', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_3'
    const userMessage = {
      ...makeUserItem({ id: 'item_user_3', threadId, turnId, text: 'next request' }),
      createdAt: '2026-07-30T01:00:00.000Z'
    }
    const before = makeAssistantTextItem({
      id: 'item_before_compaction',
      threadId,
      turnId,
      text: 'work before compaction',
      status: 'completed',
      createdAt: '2026-07-30T01:00:01.000Z'
    })
    const summary = {
      ...makeCompactionItem({
        id: 'compaction_for_turn_3',
        threadId,
        turnId,
        summary: 'fresh summary',
        replacedTokens: 200,
        pinnedConstraints: []
      }),
      createdAt: '2026-07-30T01:00:02.000Z'
    }
    const after = makeAssistantTextItem({
      id: 'item_after_compaction',
      threadId,
      turnId,
      text: 'work after compaction',
      status: 'completed',
      createdAt: '2026-07-30T01:00:03.000Z'
    })

    // Session-store insertion places the summary before the retained model
    // tail. The renderer-facing bucket restores the marker to event time.
    expect(
      placeCompactionsChronologically([summary, userMessage, before, after])
        .map((item) => item.id)
    ).toEqual([
      'item_user_3',
      'item_before_compaction',
      'compaction_for_turn_3',
      'item_after_compaction'
    ])
  })

  it('uses stable source order for invalid timestamps while keeping the turn owner first', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_invalid_time'
    const summary = {
      ...makeCompactionItem({
        id: 'compaction_invalid_time',
        threadId,
        turnId,
        summary: 'summary',
        replacedTokens: 200,
        pinnedConstraints: []
      }),
      createdAt: 'invalid'
    }
    const userMessage = {
      ...makeUserItem({ id: 'item_user_invalid_time', threadId, turnId, text: 'request' }),
      createdAt: 'invalid'
    }
    const after = {
      ...makeAssistantTextItem({
        id: 'item_after_invalid_time',
        threadId,
        turnId,
        text: 'later work',
        status: 'completed'
      }),
      createdAt: 'invalid'
    }

    expect(
      placeCompactionsChronologically([summary, userMessage, after]).map((item) => item.id)
    ).toEqual([
      'item_user_invalid_time',
      'compaction_invalid_time',
      'item_after_invalid_time'
    ])
  })

  it('preserves distinct automatic and manual markers in chronological order', () => {
    const threadId = 'thread_1'
    const turnId = 'turn_coalesce'
    const userMessage = {
      ...makeUserItem({ id: 'item_user_coalesce', threadId, turnId, text: 'request' }),
      createdAt: '2026-07-30T01:00:00.000Z'
    }
    const oldAutomatic = {
      ...makeCompactionItem({
        id: 'compaction_old_auto',
        threadId,
        turnId,
        summary: 'old automatic',
        replacedTokens: 100,
        pinnedConstraints: [],
        auto: true
      }),
      createdAt: '2026-07-30T01:00:01.000Z'
    }
    const manual = {
      ...makeCompactionItem({
        id: 'compaction_manual',
        threadId,
        turnId,
        summary: 'manual',
        replacedTokens: 150,
        pinnedConstraints: [],
        auto: false
      }),
      createdAt: '2026-07-30T01:00:02.000Z'
    }
    const latestAutomatic = {
      ...makeCompactionItem({
        id: 'compaction_latest_auto',
        threadId,
        turnId,
        summary: 'latest automatic',
        replacedTokens: 200,
        pinnedConstraints: [],
        auto: true
      }),
      createdAt: '2026-07-30T01:00:03.000Z'
    }

    expect(
      placeCompactionsChronologically([
        oldAutomatic,
        userMessage,
        manual,
        latestAutomatic
      ]).map((item) => item.id)
    ).toEqual([
      'item_user_coalesce',
      'compaction_old_auto',
      'compaction_manual',
      'compaction_latest_auto'
    ])
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
    expect(placeCompactionsChronologically(items).map((item) => item.id)).toEqual([
      'item_user_1',
      'item_assistant_1'
    ])
  })
})
