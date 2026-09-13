import { afterEach, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('never falls back to the full latest thread after an exact-turn 404', async () => {
  const runtimeRequest = vi.fn(async () => ({ ok: false, status: 404, body: JSON.stringify({ code: 'not_found', message: 'turn not found: old' }) }))
  installDsGui({ runtimeRequest })
  await expect(new KunRuntimeProvider().getThreadDetail('thread', { turnId: 'old' })).rejects.toThrow('turn not found')
  expect(runtimeRequest).toHaveBeenCalledTimes(1)
  expect(runtimeRequest.mock.calls[0]).toEqual(['/v1/threads/thread/timeline?turnId=old&limit=300', 'GET'])
})


it('forwards an exact source item and maps the target page independently from native latest metadata', async () => {
  const runtimeRequest = vi.fn(async (_path: string) => ({ ok: true, status: 200, body: JSON.stringify({
    id: 'thread', status: 'running', latestSeq: 50,
    latestTurn: { id: 'native-current', status: 'running', orchestration: 'direct' },
    turns: [{ id: 'codex:old', status: 'completed', items: [
      { id: 'early', threadId: 'thread', turnId: 'codex:old', kind: 'user_message', text: 'earliest request',
        sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: 0 } }
    ] }],
    timeline: { hasMore: false, itemCount: 1, itemBytes: 20,
      target: { turnId: 'codex:old', itemId: 'early', nextCursor: 'target-next' } }
  }) }))
  installDsGui({ runtimeRequest })
  const detail = await new KunRuntimeProvider().getThreadDetail('thread', { turnId: 'codex:old', itemId: 'early' })
  const path = new URL(runtimeRequest.mock.calls[0]![0], 'http://localhost')
  expect(Object.fromEntries(path.searchParams)).toEqual({ turnId: 'codex:old', itemId: 'early', limit: '300' })
  expect(detail).toMatchObject({ latestSeq: 50, latestTurnId: 'native-current',
    historyTarget: { turnId: 'codex:old', itemId: 'early', nextCursor: 'target-next' }, hasMoreHistory: false })
  expect(detail.blocks[0]).toMatchObject({ id: 'early', sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: 0 } })
})
