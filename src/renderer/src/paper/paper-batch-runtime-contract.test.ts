import { afterEach, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from '../agent/kun-runtime'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { installDsGui } from '../agent/kun-runtime-test-support'

afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('retains exact-turn identity on real normalized assistant blocks used by article saving', async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({
    id: 'batch-thread', status: 'idle', latestSeq: 9,
    latestTurn: { id: 'newer-turn', status: 'completed', orchestration: 'direct' },
    turns: [{ id: 'paper-turn', status: 'completed', items: [{
      id: 'answer', threadId: 'batch-thread', turnId: 'paper-turn', kind: 'assistant_text',
      role: 'assistant', status: 'completed', createdAt: '2026-10-06T00:00:00Z', text: 'Verified article'
    }] }], timeline: { hasMore: false, itemCount: 1, itemBytes: 16, target: { turnId: 'paper-turn' } }
  }) }))
  installDsGui({ runtimeRequest: request })
  const detail = await new KunRuntimeProvider().getThreadDetail('batch-thread', { turnId: 'paper-turn' })
  expect(request).toHaveBeenCalledWith('/v1/threads/batch-thread/timeline?turnId=paper-turn&limit=300', 'GET')
  expect(detail.blocks).toEqual([expect.objectContaining({ kind: 'assistant', turnId: 'paper-turn', text: 'Verified article' })])
  expect(detail.latestTurnId).toBe('newer-turn')
})
