import { describe, expect, it } from 'vitest'
import { ThreadTodoListSchema } from '../contracts/thread-todos.js'
import { delegatedPlanTodoList } from './delegated-plan-todos.js'

describe('delegatedPlanTodoList', () => {
  it('keeps the first in-progress step current and drops blank steps so the list validates', () => {
    const todos = delegatedPlanTodoList({
      threadId: 'thr',
      idPrefix: 'acp_plan',
      now: '2026-10-10T00:00:00.000Z',
      entries: [
        { content: 'Explore patterns', status: 'completed' },
        { content: 'Update task list', status: 'in_progress' },
        { content: '   ', status: 'pending' },
        { content: 'Write the view body', status: 'in_progress' }
      ]
    })
    expect(todos.items.map((item) => [item.id, item.status])).toEqual([
      ['acp_plan_0', 'completed'],
      ['acp_plan_1', 'in_progress'],
      ['acp_plan_3', 'pending']
    ])
    expect(ThreadTodoListSchema.safeParse(todos).success).toBe(true)
  })
})
