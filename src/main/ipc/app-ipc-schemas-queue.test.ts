import { describe, expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas/runtime'
import {
  kunThreadCancelQueuedPath, kunThreadQueuePositionPath,
  kunThreadQueueResumePath, kunThreadQueuedTurnsPath
} from '../../shared/kun-endpoints'

const operations = [
  [kunThreadCancelQueuedPath('thread/one', 'turn/one'), 'POST'],
  [kunThreadQueuePositionPath('thread/one', 'turn/one'), 'PATCH'],
  [kunThreadQueueResumePath('thread/one'), 'POST'],
  [kunThreadQueuedTurnsPath('thread/one'), 'GET']
] as const

describe('desktop queue endpoint boundary', () => {
  it.each(operations)('admits %s only with %s', (path, method) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method }).success).toBe(true)
    for (const wrong of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].filter((value) => value !== method)) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: wrong }).success).toBe(false)
    }
    expect(runtimeRequestPayloadSchema.safeParse({ path: `${path}/extra`, method }).success).toBe(false)
  })
  it.each([
    '/v1/threads//queued-turns',
    '/v1/threads/t/turns//cancel-queued',
    '/v1/threads/t/turns/q/delete',
    '/v1/threads/t/queue/drop-all'
  ])('rejects unmodeled or empty queue identities: %s', (path) => {
    expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
  })
})
