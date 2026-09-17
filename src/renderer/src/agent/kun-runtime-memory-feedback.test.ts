import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'

afterEach(() => vi.unstubAllGlobals())

describe('KunRuntimeProvider memory feedback actions', () => {
  it('routes confirmation and correction through the shared runtime request bridge', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path.endsWith('/confirm')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            confirmation: {
              memoryId: 'mem_1',
              eventId: 'feedback-confirm-event',
              confirmedAt: '2026-09-15T00:00:00.000Z',
              replayed: false
            }
          })
        }
      }
      expect(path).toBe('/v1/memory/mem_1/correct')
      expect(method).toBe('POST')
      expect(body).toBe(JSON.stringify({
        operationId: 'op_correct',
        access: { project: 'project-a' },
        replacement: { content: 'Corrected fact', confidence: 0.9 }
      }))
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          correction: {
            previousMemoryId: 'mem_1',
            replacementMemoryId: 'mem_correction_1',
            eventId: 'feedback-correct-event',
            correctedAt: '2026-09-15T00:00:00.000Z',
            replayed: false
          }
        })
      }
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    const provider = new KunRuntimeProvider()

    await expect(provider.confirmMemory('mem_1', 'op_confirm', { workspace: 'D:/workspace' })).resolves.toMatchObject({
      memoryId: 'mem_1',
      replayed: false
    })
    await expect(provider.correctMemory(
      'mem_1',
      'op_correct',
      { content: 'Corrected fact', confidence: 0.9 },
      { project: 'project-a' }
    )).resolves.toMatchObject({
      previousMemoryId: 'mem_1',
      replacementMemoryId: 'mem_correction_1'
    })

    expect(runtimeRequest).toHaveBeenNthCalledWith(
      1,
      '/v1/memory/mem_1/confirm',
      'POST',
      JSON.stringify({ operationId: 'op_confirm', access: { workspace: 'D:/workspace' } })
    )
  })
})
