import { describe, expect, it } from 'vitest'
import type { ThreadGoal } from '../contracts/threads.js'
import { makeGoalContextItem, makeUserItem } from '../domain/item.js'
import {
  filterGoalContextsForActiveGoal,
  filterGoalContextsForGoalKey,
  goalContextKey,
  isPostToolFailureProgressText,
  isUserDirectedNoToolText
} from './continuation-instructions.js'

function activeGoal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: 'thread_goal_lifecycle',
    objective: 'Complete the durable goal safely.',
    status: 'active',
    tokenBudget: 500,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides
  }
}

describe('goal context lifecycle projection', () => {
  it('only forwards the current active goal generation', () => {
    const initial = activeGoal()
    const replacement = activeGoal({
      objective: 'Work on the replacement goal instead.',
      updatedAt: '2026-08-06T00:05:00.000Z'
    })
    const user = makeUserItem({
      id: 'item_user',
      threadId: initial.threadId,
      turnId: 'turn_goal_lifecycle',
      text: 'Continue.'
    })
    const initialContext = makeGoalContextItem({
      id: 'item_initial_goal',
      threadId: initial.threadId,
      turnId: 'turn_goal_lifecycle',
      goalKey: goalContextKey(initial)!,
      text: 'Initial active goal instruction.'
    })
    const replacementContext = makeGoalContextItem({
      id: 'item_replacement_goal',
      threadId: initial.threadId,
      turnId: 'turn_goal_lifecycle',
      goalKey: goalContextKey(replacement)!,
      text: 'Replacement active goal instruction.'
    })
    const items = [user, initialContext, replacementContext]

    expect(filterGoalContextsForActiveGoal(items, initial)).toEqual([user, initialContext])
    expect(filterGoalContextsForActiveGoal(items, replacement)).toEqual([user, replacementContext])
  })

  it('removes active-goal instructions when the goal is no longer active or is cleared', () => {
    const active = activeGoal()
    const user = makeUserItem({
      id: 'item_goal_user',
      threadId: active.threadId,
      turnId: 'turn_goal_lifecycle',
      text: 'A normal follow-up.'
    })
    const context = makeGoalContextItem({
      id: 'item_goal_context',
      threadId: active.threadId,
      turnId: 'turn_goal_lifecycle',
      goalKey: goalContextKey(active)!,
      text: 'Continue working toward the active thread goal.'
    })

    for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const) {
      expect(filterGoalContextsForActiveGoal([user, context], { ...active, status }))
        .toEqual([user])
    }
    expect(filterGoalContextsForActiveGoal([user, context], undefined)).toEqual([user])
  })

  it('retains a request-captured generation after the live goal changes', () => {
    const active = activeGoal()
    const user = makeUserItem({
      id: 'item_goal_snapshot_user',
      threadId: active.threadId,
      turnId: 'turn_goal_snapshot',
      text: 'Continue the current request.'
    })
    const context = makeGoalContextItem({
      id: 'item_goal_snapshot_context',
      threadId: active.threadId,
      turnId: 'turn_goal_snapshot',
      goalKey: goalContextKey(active)!,
      text: 'Captured request goal instruction.'
    })
    const capturedKey = goalContextKey(active)!

    expect(filterGoalContextsForGoalKey([user, context], capturedKey)).toEqual([user, context])
    expect(filterGoalContextsForActiveGoal([user, context], {
      ...active,
      status: 'complete'
    })).toEqual([user])
  })

  it('keeps only one record for the current goal generation', () => {
    const active = activeGoal()
    const first = makeGoalContextItem({
      id: 'item_first_goal_context',
      threadId: active.threadId,
      turnId: 'turn_first',
      goalKey: goalContextKey(active)!,
      text: 'Stable active goal context.'
    })
    const duplicate = makeGoalContextItem({
      id: 'item_duplicate_goal_context',
      threadId: active.threadId,
      turnId: 'turn_second',
      goalKey: goalContextKey(active)!,
      text: 'Stable active goal context.'
    })

    expect(filterGoalContextsForActiveGoal([first, duplicate], active)).toEqual([first])
  })
})

describe('post-tool-failure progress classifier', () => {
  it('recognizes the Chinese investigation status that previously ended the turn', () => {
    expect(isPostToolFailureProgressText(
      '我来调查页面上下文从前端到后端的完整链路。先定位关键符号。'
    )).toBe(true)
    expect(isPostToolFailureProgressText('我来排查调用路径。')).toBe(true)
    expect(isPostToolFailureProgressText('先搜索相关实现。')).toBe(true)
  })

  it('does not recover user questions, blockers, or factual failure reports', () => {
    expect(isPostToolFailureProgressText('这个路径不存在，需要你确认工作区。')).toBe(false)
    expect(isPostToolFailureProgressText('请问要继续使用这个路径吗？')).toBe(false)
    expect(isPostToolFailureProgressText('搜索失败：工作区不存在，无法继续。')).toBe(false)
  })
})

describe('user-directed no-tool classifier', () => {
  it('recognizes Chinese and English questions and wait-for-user replies', () => {
    expect(isUserDirectedNoToolText('请问你选择哪个方案？')).toBe(true)
    expect(isUserDirectedNoToolText('Which option should I use?')).toBe(true)
    expect(isUserDirectedNoToolText('需要你确认后才能继续。')).toBe(true)
  })

  it('does not classify ordinary progress announcements as user-directed', () => {
    expect(isUserDirectedNoToolText('I will run the build now.')).toBe(false)
    expect(isUserDirectedNoToolText('下一步我会运行构建')).toBe(false)
    expect(isUserDirectedNoToolText('   ')).toBe(false)
  })
})
