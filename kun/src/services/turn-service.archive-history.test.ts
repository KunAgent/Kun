import { describe, expect, it } from 'vitest'
import { makeAssistantTextItem, makeCompactionItem, makeGoalContextItem, makeUserItem } from '../domain/item.js'
import { buildArchivedActiveHistory } from './archive-history-commit.js'

describe('buildArchivedActiveHistory', () => {
  it('removes the archived visible head while preserving internal records and the recent tail', () => {
    const threadId = 'thread_archive_history'
    const archivedUser = makeUserItem({
      id: 'user_old', threadId, turnId: 'turn_old', text: 'old'
    })
    const retainedUser = makeUserItem({
      id: 'user_recent', threadId, turnId: 'turn_recent', text: 'recent'
    })
    const retainedAssistant = makeAssistantTextItem({
      id: 'assistant_recent', threadId, turnId: 'turn_recent', text: 'answer'
    })
    const summary = makeCompactionItem({
      id: 'compaction_archive',
      threadId,
      turnId: 'turn_old',
      summary: 'old summary',
      replacedTokens: 42,
      pinnedConstraints: [],
      auto: false
    })
    const goal = makeGoalContextItem({
      id: 'goal_context',
      threadId,
      turnId: 'turn_old',
      text: 'keep goal'
    })

    const result = buildArchivedActiveHistory(
      [archivedUser, summary, goal, retainedUser, retainedAssistant],
      summary,
      [retainedUser, retainedAssistant]
    )

    expect(result.map((item) => item.id)).toEqual([
      'compaction_archive', 'goal_context', 'user_recent', 'assistant_recent'
    ])
    expect(result).not.toContain(archivedUser)
  })
})
