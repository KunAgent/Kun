import { describe, expect, it } from 'vitest'
import {
  decideProviderQueueAdmission,
  normalizeProviderQueueKey,
  normalizeProviderQueuePolicy
} from '../src/contracts/provider-request-queue.js'

describe('provider request queue contract', () => {
  it('normalizes provider/account keys without exposing credentials', () => {
    expect(normalizeProviderQueueKey({ providerId: 'openai', accountId: 'team-a' })).toEqual({
      ok: true,
      value: { providerId: 'openai', accountId: 'team-a' }
    })
    expect(normalizeProviderQueueKey({ providerId: 'openai' })).toEqual({ ok: true, value: { providerId: 'openai' } })
  })

  it('admits work immediately when concurrency is available', () => {
    expect(decideProviderQueueAdmission(
      { maxConcurrent: 2, maxQueued: 10 },
      { active: 1, queued: 10 },
      'interactive'
    )).toEqual({ status: 'run', reason: 'concurrency-available' })
  })

  it('queues when active work is full and rejects when the queue is full', () => {
    const policy = { maxConcurrent: 1, maxQueued: 2 }
    expect(decideProviderQueueAdmission(policy, { active: 1, queued: 1 }, 'background'))
      .toEqual({ status: 'queue', reason: 'concurrency-full' })
    expect(decideProviderQueueAdmission(policy, { active: 1, queued: 2 }, 'scheduled'))
      .toEqual({ status: 'reject', reason: 'queue-full' })
  })

  it.each([
    [{ providerId: '' }, 'invalid-provider-id'],
    [{ providerId: 'x', accountId: '\u0000' }, 'invalid-account-id']
  ])('rejects unsafe queue keys %#', (input, error) => {
    expect(normalizeProviderQueueKey(input)).toEqual({ ok: false, error })
  })

  it.each([
    [{ maxConcurrent: 0, maxQueued: 1 }, 'invalid-concurrency'],
    [{ maxConcurrent: 1, maxQueued: -1 }, 'invalid-queue-size'],
    [{ maxConcurrent: 1, maxQueued: 1, extra: true }, 'unknown-field']
  ])('rejects invalid queue policies %#', (input, error) => {
    expect(normalizeProviderQueuePolicy(input)).toEqual({ ok: false, error })
  })

  it('fails closed for invalid runtime capacity, policy, or priority', () => {
    expect(decideProviderQueueAdmission({ maxConcurrent: 1, maxQueued: 1 }, { active: -1, queued: 0 }, 'interactive'))
      .toEqual({ status: 'reject', reason: 'invalid' })
    expect(decideProviderQueueAdmission({ maxConcurrent: 0, maxQueued: 1 }, { active: 0, queued: 0 }, 'interactive'))
      .toEqual({ status: 'reject', reason: 'invalid' })
    expect(decideProviderQueueAdmission({ maxConcurrent: 1, maxQueued: 1 }, { active: 0, queued: 0 }, 'urgent' as never))
      .toEqual({ status: 'reject', reason: 'invalid' })
    expect(decideProviderQueueAdmission(null, null, 'interactive')).toEqual({ status: 'reject', reason: 'invalid' })
  })
})
