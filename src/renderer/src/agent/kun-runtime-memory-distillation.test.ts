import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'

afterEach(() => vi.restoreAllMocks())

describe('KunRuntimeProvider Memory candidate requests', () => {
  const workspace = '/workspace/alpha & beta'

  it('lists candidates through the workspace-scoped endpoint', async () => {
    const candidates = [{ id: 'candidate-1', status: 'pending' }]
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
      ok: true, status: 200, body: JSON.stringify({ candidates })
    })

    await expect(new KunRuntimeProvider().listMemoryDistillationCandidates(workspace))
      .resolves.toEqual(candidates)
    const [path, method] = request.mock.calls[0]
    const url = new URL(path, 'http://localhost')
    expect(method).toBe('GET')
    expect(url.pathname).toBe('/v1/memory/distillation')
    expect([...url.searchParams.entries()]).toEqual([['workspace', workspace]])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['allow', 'deny', 'withdraw'] as const)(
    'sends %s for the exact candidate and workspace', async (decision) => {
      const candidate = { id: 'candidate/one', status: 'pending' }
      const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
        ok: true, status: 200, body: JSON.stringify({ candidate })
      })

      await expect(new KunRuntimeProvider().decideMemoryDistillationCandidate(
        candidate.id, decision, workspace
      )).resolves.toEqual(candidate)
      const [path, method, body] = request.mock.calls[0]
      const url = new URL(path, 'http://localhost')
      expect(url.pathname).toBe('/v1/memory/distillation/candidate%2Fone/decision')
      expect([...url.searchParams.entries()]).toEqual([['workspace', workspace]])
      expect(method).toBe('POST')
      expect(JSON.parse(body!)).toEqual({ decision })
      expect(request).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects invalid list responses instead of treating them as empty', async () => {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({
      ok: true, status: 200, body: 'invalid json'
    })

    await expect(new KunRuntimeProvider().listMemoryDistillationCandidates(workspace))
      .rejects.toThrow('runtime returned an invalid memory candidate list')
  })
})
