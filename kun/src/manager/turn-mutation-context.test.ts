import { afterEach, expect, it } from 'vitest'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import { forgetTurnLease, mutationFenceForValue, rememberTurnLease, runWithTurnMutationFence } from './turn-mutation-context.js'

const source: ThreadExecutionLease = { threadId: 'thr_source', turnId: 'turn_source',
  ownerFlavor: 'production', ownerInstanceId: 'runtime-fixture', fencingToken: 1,
  acquiredAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-11-01T00:01:00.000Z' }
const next = { ...source, turnId: 'turn_next', fencingToken: 2 }
afterEach(() => { forgetTurnLease(source); forgetTurnLease(next) })

it('does not attach the source lease when forked items retain their original turn ids', () => {
  rememberTurnLease(source)
  expect(mutationFenceForValue({ threadId: 'thr_fork', item: { turnId: source.turnId } })).toBeUndefined()
  expect(mutationFenceForValue({ threadId: source.threadId, item: { turnId: source.turnId } }))
    .toMatchObject({ threadId: source.threadId, fencingToken: 1 })
})

it('retains a stale same-thread generation instead of upgrading a delayed writer to the next turn', () => {
  rememberTurnLease(source)
  rememberTurnLease(next)
  expect(mutationFenceForValue({ threadId: source.threadId, turnId: source.turnId })).toMatchObject({ fencingToken: 1 })
  expect(runWithTurnMutationFence(source, () => mutationFenceForValue({ threadId: source.threadId, turnId: next.turnId })))
    .toMatchObject({ fencingToken: 1 })
})
