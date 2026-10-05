import { describe, expect, it } from 'vitest'
import { createThreadRecord } from './thread.js'
import { createTurnRecord } from './turn.js'
import { latestExecutedTurn, restartSourceIsCurrent, isQueueExecutionBlocked } from './queue-execution-state.js'

function thread() {
  return { ...createThreadRecord({ id: 'thread', title: '', workspace: '/tmp', model: 'test' }),
    turns: [createTurnRecord({ id: 'A', threadId: 'thread', prompt: 'A', status: 'failed' }),
      createTurnRecord({ id: 'B', threadId: 'thread', prompt: 'B' }),
      { ...createTurnRecord({ id: 'C', threadId: 'thread', prompt: 'C', status: 'aborted' }), terminalCode: 'queue_cancelled' }],
    queueControl: { reason: 'restart_recovery' as const, sourceTurnId: 'A', pausedAt: 'now' } }
}

describe('execution source is separate from queued inputs', () => {
  it('ignores queued/cancelled inputs but never skips a newer executed terminal turn', () => {
    const value = thread()
    expect(latestExecutedTurn(value)?.id).toBe('A')
    expect(restartSourceIsCurrent(value, 'A')).toBe(true)
    value.turns.push(createTurnRecord({ id: 'D', threadId: 'thread', prompt: 'D', status: 'completed' }))
    expect(restartSourceIsCurrent(value, 'A')).toBe(false)
  })
  it('cancels deferred recovery when explicit queue resume clears its barrier', () => {
    const value = thread()
    expect(restartSourceIsCurrent({ ...value, queueControl: undefined }, 'A')).toBe(false)
    expect(restartSourceIsCurrent({ ...value, queueControl: { ...value.queueControl, reason: 'user_stop' } }, 'A')).toBe(false)
  })
})

it('respects legacy Stop and orphaned terminal evidence until explicit resume', () => {
  const value = thread()
  expect(isQueueExecutionBlocked({ ...value, queueControl: undefined, turns: [
    { ...value.turns[0]!, status: 'aborted' }, value.turns[1]!
  ] })).toBe(true)
  const legacy = { ...value, queueControl: undefined, turns: [
    { ...value.turns[0]!, terminalCode: 'orphaned_after_restart' }, value.turns[1]!
  ] }
  expect(isQueueExecutionBlocked(legacy)).toBe(true)
  expect(isQueueExecutionBlocked({ ...legacy, queueResumeSourceTurnId: 'A' })).toBe(false)
})
