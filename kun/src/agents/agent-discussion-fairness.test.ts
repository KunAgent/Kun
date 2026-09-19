import { expect, it } from 'vitest'
import { AgentDiscussionFairness } from './agent-discussion-fairness.js'

it('prioritizes direct requests but gives a waiting collaborator every third admission', () => {
  const queue = new AgentDiscussionFairness()
  const start = (priority: 'user' | 'peer') => {
    queue.resetWaiting(); queue.waiting('agent', 'user'); queue.waiting('agent', 'peer')
    expect(queue.canStart('agent', priority)).toBe(true)
    expect(queue.canStart('agent', priority === 'user' ? 'peer' : 'user')).toBe(false)
    queue.started('agent', priority)
  }
  start('user'); start('user'); start('peer'); start('user')
  queue.resetWaiting(); queue.waiting('other', 'peer')
  expect(queue.canStart('other', 'peer')).toBe(true)
  expect(queue.canStart('agent', 'user')).toBe(true)
})
