import { afterEach, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.unstubAllGlobals() })

it('never falls back to the full latest thread after an exact-turn 404', async () => {
  const runtimeRequest = vi.fn(async () => ({ ok: false, status: 404, body: JSON.stringify({ code: 'not_found', message: 'turn not found: old' }) }))
  installDsGui({ runtimeRequest })
  await expect(new KunRuntimeProvider().getThreadDetail('thread', { turnId: 'old' })).rejects.toThrow('turn not found')
  expect(runtimeRequest).toHaveBeenCalledTimes(1)
  expect(runtimeRequest.mock.calls[0]).toEqual(['/v1/threads/thread/timeline?turnId=old&limit=300', 'GET'])
})
