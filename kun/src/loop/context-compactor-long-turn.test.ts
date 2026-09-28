import { describe, expect, it } from 'vitest'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import {
  makeCompactionItem,
  makeModelContextItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserItem
} from '../domain/item.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import { ContextCompactor } from './context-compactor.js'

/**
 * Long-turn reclaim regression coverage.
 *
 * A running turn accumulates tool interactions across many model steps. The
 * compactor must keep reclaiming that history instead of pinning the entire
 * active turn, which used to leave `replacedTokens: 0` on every follow-up
 * compaction and made the send-time guard fail with `no_compactable_history`
 * on an otherwise healthy conversation.
 *
 * The invariants under test:
 * - the active turn's original user instruction is never re-summarized,
 * - every still-active `model_context` capsule survives verbatim,
 * - the newest complete tool interaction stays intact at the tail,
 * - repeated compaction never grows the history nor re-summarizes only a
 *   previous summary.
 */
describe('ContextCompactor long-turn reclaim', () => {
  const threadId = 'thr_long_turn_reclaim'
  const longTurnId = 'turn_long_turn_reclaim'
  const originalUserText = 'Run the migration and keep the audit trail intact.'

  function toolBatch(index: number, bytes = 4_000): TurnItem[] {
    const callId = `call_batch_${index}`
    return [
      makeToolCallItem({
        id: `item_call_${index}`,
        threadId,
        turnId: longTurnId,
        callId,
        toolName: 'read',
        arguments: { path: `src/batch-${index}.ts` },
        status: 'completed'
      }),
      makeToolResultItem({
        id: `item_result_${index}`,
        threadId,
        turnId: longTurnId,
        callId,
        toolName: 'read',
        output: `batch ${index} payload ${'x'.repeat(bytes)}`
      })
    ]
  }

  function flatten(batches: readonly TurnItem[][]): TurnItem[] {
    return batches.flat(2)
  }

  /**
   * The state a running turn presents right after the first compaction: the
   * previous summary, the active turn's own request, its context capsule and a
   * run of completed tool batches.
   */
  function afterFirstCompaction(
    batchCount: number,
    contextCapsuleText: string
  ): TurnItem[] {
    const compactor = new ContextCompactor()
    const previousSummary = makeCompactionItem({
      id: 'compaction_previous_turn_tail',
      threadId,
      turnId: 'turn_before_long_turn',
      summary: 'Earlier work summary that must be carried forward.',
      replacedTokens: 12_000,
      pinnedConstraints: [],
      auto: true
    })
    const seed = [
      previousSummary,
      makeUserItem({
        id: 'item_long_user',
        threadId,
        turnId: longTurnId,
        text: originalUserText
      }),
      ...flatten(Array.from({ length: batchCount }, (_, index) => toolBatch(index)))
    ]
    const first = compactor.compact({
      threadId,
      turnId: longTurnId,
      history: seed,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })
    return first.next.concat(makeModelContextItem({
      id: 'item_long_context',
      threadId,
      turnId: longTurnId,
      stepIndex: 0,
      contentDigest: 'long-context-digest',
      blocks: [],
      text: contextCapsuleText
    }))
  }

  function foldedIds(summaryItem: TurnItem): string[] {
    return summaryItem.kind === 'compaction' ? summaryItem.sourceItemIds ?? [] : []
  }

  it('reclaims completed tool batches of the active turn after a prior compaction', () => {
    const compactor = new ContextCompactor()
    const history = afterFirstCompaction(6, 'Active turn persona capsule that must stay verbatim.')

    const result = compactor.compact({
      threadId,
      turnId: longTurnId,
      history,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })

    // Previously this returned 0 and the next send failed the hard cap.
    expect(result.replacedTokens).toBeGreaterThan(0)
    // The instruction is lifted to the front of the retained tail, so it never
    // appears among the folded sources nor inside the summary text.
    const sourceIds = foldedIds(result.summaryItem) ?? []
    expect(sourceIds).not.toContain('item_long_user')
    expect(result.next[0]?.kind).toBe('compaction')
    expect(result.next[1]).toMatchObject({ kind: 'user_message', id: 'item_long_user' })
    // The completed batches of the active turn became the foldable head.
    expect(sourceIds.length).toBeGreaterThan(0)
    // The active-turn context capsule survives verbatim after the summary.
    const contextItems = result.next.filter((item) => item.kind === 'model_context')
    expect(contextItems).toHaveLength(1)
    expect(contextItems[0]?.kind === 'model_context' ? contextItems[0].text : '').toBe(
      'Active turn persona capsule that must stay verbatim.'
    )
    expect(result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '')
      .not.toContain(originalUserText)
    expect(repairModelHistoryItems([...result.next])).toEqual(result.next)
  })

  it('reclaims across parallel batches without orphaning a tool interaction', () => {
    const compactor = new ContextCompactor()
    const parallelCallIds = ['call_par_a', 'call_par_b', 'call_par_c']
    // A parallel batch stores all calls first, then all results, the way a
    // single model step dispatches them.
    const parallelBatch: TurnItem[] = [
      ...parallelCallIds.map((callId) => makeToolCallItem({
        id: `item_par_call_${callId}`,
        threadId,
        turnId: longTurnId,
        callId,
        toolName: 'grep',
        arguments: { pattern: callId },
        status: 'completed'
      })),
      ...parallelCallIds.map((callId) => makeToolResultItem({
        id: `item_par_result_${callId}`,
        threadId,
        turnId: longTurnId,
        callId,
        toolName: 'grep',
        output: `match ${callId}`
      }))
    ]
    const seed: TurnItem[] = [
      makeUserItem({
        id: 'item_par_user',
        threadId,
        turnId: longTurnId,
        text: originalUserText
      }),
      ...flatten(Array.from({ length: 4 }, (_, index) => toolBatch(index))),
      ...parallelBatch
    ]

    const first = compactor.compact({
      threadId,
      turnId: longTurnId,
      history: seed,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })
    expect(first.replacedTokens).toBeGreaterThan(0)
    // Second pass: the retained tail holds the parallel batch plus the summary.
    const second = compactor.compact({
      threadId,
      turnId: longTurnId,
      history: first.next,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })
    expect(repairModelHistoryItems([...second.next])).toEqual(second.next)
    // No tool result may be left without its call inside the retained tail.
    const retainedCallIds = new Set(
      second.next
        .filter((item) => item.kind === 'tool_call')
        .flatMap((item) => item.kind === 'tool_call' ? [item.callId] : [])
    )
    for (const item of second.next) {
      if (item.kind !== 'tool_result') continue
      expect(retainedCallIds.has(item.callId)).toBe(true)
    }
    // The parallel batch never leaks its instruction into the summary text.
    const sourceIds = foldedIds(second.summaryItem)
    expect(sourceIds ?? []).not.toContain('item_par_user')
  })

  it('keeps a tool result whose call sits in the reclaimed head', () => {
    const compactor = new ContextCompactor()
    const history = afterFirstCompaction(4, 'capsule')
    // A later dispatch arrives after the context capsule. Reclaiming the
    // earlier batches must not strand this result behind the summary, even
    // though its call now precedes the fold boundary.
    const trailingCall = makeToolCallItem({
      id: 'item_call_trailing',
      threadId,
      turnId: longTurnId,
      callId: 'call_trailing',
      toolName: 'read',
      arguments: { path: 'src/trailing.ts' },
      status: 'completed'
    })
    const trailingResult = makeToolResultItem({
      id: 'item_result_trailing',
      threadId,
      turnId: longTurnId,
      callId: 'call_trailing',
      toolName: 'read',
      output: 'trailing payload'
    })

    const result = compactor.compact({
      threadId,
      turnId: longTurnId,
      history: [...history, trailingCall, trailingResult],
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })

    expect(result.replacedTokens).toBeGreaterThan(0)
    // The instruction is never folded into summary text and the trailing
    // interaction stays whole behind the summary.
    const sourceIds = foldedIds(result.summaryItem) ?? []
    expect(sourceIds).not.toContain('item_long_user')
    expect(sourceIds).not.toContain('item_call_trailing')
    expect(result.next.some((item) => item.id === 'item_call_trailing')).toBe(true)
    expect(result.next.some((item) => item.id === 'item_result_trailing')).toBe(true)
    expect(repairModelHistoryItems([...result.next])).toEqual(result.next)
  })

  it('returns the history unchanged when only a summary and the user message remain', () => {
    const compactor = new ContextCompactor()
    const previousSummary = makeCompactionItem({
      id: 'compaction_only_summary',
      threadId,
      turnId: longTurnId,
      summary: 'Existing handoff summary.',
      replacedTokens: 4_000,
      pinnedConstraints: [],
      auto: true
    })
    const history = [
      previousSummary,
      makeUserItem({ id: 'item_only_user', threadId, turnId: longTurnId, text: originalUserText })
    ]

    const result = compactor.compact({
      threadId,
      turnId: longTurnId,
      history,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })

    expect(result.replacedTokens).toBe(0)
    expect(result.next).toEqual(history)
  })

  it('does not compact away the current user message when it alone exceeds the cap', () => {
    const compactor = new ContextCompactor()
    const oversizedUser = makeUserItem({
      id: 'item_oversized_user',
      threadId,
      turnId: longTurnId,
      text: `oversized current input ${'工'.repeat(90_000)}`
    })
    const history = [
      oversizedUser,
      ...flatten(Array.from({ length: 2 }, (_, index) => toolBatch(index, 200)))
    ]

    const result = compactor.compact({
      threadId,
      turnId: longTurnId,
      history,
      prefix: createImmutablePrefix(),
      keepRecent: 1,
      mode: 'force'
    })

    expect(result.next.some((item) => item.id === 'item_oversized_user')).toBe(true)
    expect(repairModelHistoryItems([...result.next])).toEqual(result.next)
  })
})
