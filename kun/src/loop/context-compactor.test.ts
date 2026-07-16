import { describe, expect, it } from 'vitest'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { ContextCompactor } from './context-compactor.js'

describe('ContextCompactor', () => {
  it('preserves numbered problem outlines when heuristic compaction is the fallback', () => {
    const threadId = 'thr_compaction_outline'
    const turnId = 'turn_compaction_outline'
    const problems = Array.from(
      { length: 80 },
      (_, index) => `Problem ${index + 1}: preserve finding ${index + 1}`
    )
    const history: TurnItem[] = [
      makeUserItem({
        id: 'item_user_start',
        threadId,
        turnId,
        text: 'Repeat this instruction verbatim.'
      }),
      makeAssistantTextItem({
        id: 'item_problem_list',
        threadId,
        turnId,
        status: 'completed',
        text: ['Current problem list:', ...problems].join('\n')
      }),
      ...Array.from({ length: 50 }, (_, index) =>
        makeAssistantTextItem({
          id: `item_filler_${index}`,
          threadId,
          turnId,
          status: 'completed',
          text: `Routine progress note ${index + 1}.`
        })
      ),
      makeUserItem({
        id: 'item_recent_tail',
        threadId,
        turnId,
        text: 'Active Skill: retained-tail-only-skill\nRepeat this instruction verbatim.'
      })
    ]

    const result = new ContextCompactor().compact({
      threadId,
      turnId,
      history,
      prefix: createImmutablePrefix({
        pinnedConstraints: ['system: preserve user intent across compaction']
      }),
      keepRecent: 1,
      reason: 'test forced fallback summary'
    })

    expect(result.summaryItem.kind).toBe('compaction')
    if (result.summaryItem.kind !== 'compaction') return
    expect(result.summaryItem.summary).toContain('Problem 1: preserve finding 1')
    expect(result.summaryItem.summary).toContain('Problem 42: preserve finding 42')
    expect(result.summaryItem.summary).toContain('Problem 80: preserve finding 80')
    expect(result.summaryItem.summary).not.toContain('middle item(s) omitted from this compact summary')
    // The retained tail is sent verbatim after the summary. It must not be
    // repeated inside the summary as well. A repeated instruction in a
    // different turn is still preserved: the folded copy is summarized and
    // the newest copy stays verbatim in the tail.
    expect(result.summaryItem.summary).toContain('Repeat this instruction verbatim.')
    expect(result.summaryItem.summary).not.toContain('Active Skill: retained-tail-only-skill')
    expect(result.next.at(-1)).toMatchObject({
      id: 'item_recent_tail',
      text: 'Active Skill: retained-tail-only-skill\nRepeat this instruction verbatim.'
    })
  })
})
