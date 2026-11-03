import { afterEach, describe, expect, it, vi } from 'vitest'
import { rendererRuntimeClient } from './runtime-client'
import { previewRuntimeMemoryContext } from './kun-runtime-memory-context'

const body = { memories: [], referenceBlocks: [], characterCount: 0, characterBudget: 6000,
  relations: { state: 'ready', automaticEnabled: false, annotations: [], block: '', omittedByBudget: 0 } }
describe('Memory context renderer client', () => {
  afterEach(() => vi.restoreAllMocks())
  it('uses the allowlisted POST route and passes cancellation', async () => {
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
      ok: true, status: 200, body: JSON.stringify(body)
    })
    const signal = new AbortController().signal
    expect(await previewRuntimeMemoryContext({ query: 'database', workspace: '/fixture' }, signal)).toEqual(body)
    expect(request).toHaveBeenCalledWith('/v1/memory/context/preview', 'POST',
      JSON.stringify({ query: 'database', workspace: '/fixture' }), { signal })
  })
  it('rejects malformed responses and never echoes server error content', async () => {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest')
      .mockResolvedValueOnce({ ok: false, status: 503, body: 'private-path' })
      .mockResolvedValueOnce({ ok: true, status: 200, body: '{"secret":"private-path"}' })
    await expect(previewRuntimeMemoryContext({ query: 'database', workspace: '/fixture' }))
      .rejects.toThrow('Memory context preview is unavailable')
    await expect(previewRuntimeMemoryContext({ query: 'database', workspace: '/fixture' }))
      .rejects.toThrow('Invalid memory context preview response')
  })
})
