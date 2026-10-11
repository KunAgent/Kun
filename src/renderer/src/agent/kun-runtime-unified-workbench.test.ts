import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

const thread = {
  id: 'thr_old_ade', title: 'Old ADE', workspace: '/repo', model: 'm',
  mode: 'agent', status: 'idle', workspaceMode: 'ade',
  collaboration: { enabled: true }, createdAt: 't0', updatedAt: 't1'
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider unified Code inventory', () => {
  it('sends the scope and recognizes the server echo', async () => {
    const runtimeRequest = vi.fn(async (_path: string) => ({
      ok: true, status: 200,
      body: JSON.stringify({ threads: [thread], workbenchScope: 'code', hasMore: false })
    }))
    installDsGui({ runtimeRequest })
    const page = await new KunRuntimeProvider().listThreadsPage({ workbenchScope: 'code', limit: 1 })
    expect(runtimeRequest.mock.calls[0]?.[0]).toContain('workbench_scope=code')
    expect(page.workbenchScopeApplied).toBe(true)
    expect(page.threads[0]?.collaboration).toEqual({ enabled: true })
  })

  it('does not treat an old runtime that ignores the scope as a complete inventory', async () => {
    installDsGui({ runtimeRequest: vi.fn(async () => ({
      ok: true, status: 200, body: JSON.stringify({ threads: [thread], hasMore: false })
    })) })
    const provider = new KunRuntimeProvider()
    expect((await provider.listThreadsPage({ workbenchScope: 'code' })).workbenchScopeApplied)
      .toBe(false)
    await expect(provider.listThreads({ workbenchScope: 'code' }))
      .rejects.toThrow(/does not support the unified Code workbench query/)
  })

  it('updates the task collaboration policy through the thread API', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true, status: 200, body: JSON.stringify({ ...thread, collaboration: { enabled: false } })
    }))
    installDsGui({ runtimeRequest })
    await expect(new KunRuntimeProvider().updateThreadCollaboration('thr/one', false))
      .resolves.toMatchObject({ collaboration: { enabled: false } })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr%2Fone', 'PATCH', JSON.stringify({ collaboration: { enabled: false } })
    )
  })
})
