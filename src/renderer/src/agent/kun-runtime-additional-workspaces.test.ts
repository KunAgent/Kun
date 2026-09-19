import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider additional workspaces', () => {
  it('creates a thread with extra folders from the GUI project folder set', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/model-connections') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            revision: 4,
            providers: [{
              id: 'codex',
              accountId: 'account:codex',
              configured: true,
              models: ['gpt-live']
            }],
            defaultProviderId: 'codex',
            defaultAccountId: 'account:codex',
            defaultModel: 'gpt-live'
          })
        }
      }
      expect(path).toBe('/v1/threads')
      expect(method).toBe('POST')
      expect(JSON.parse(body ?? '{}')).toMatchObject({
        workspace: '/Users/zxy/Code/frontend',
        additionalWorkspaces: ['/Users/zxy/Code/backend']
      })
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_multi',
          title: 'Frontend',
          workspace: '/Users/zxy/Code/frontend',
          additionalWorkspaces: ['/Users/zxy/Code/backend'],
          model: 'gpt-live',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't0',
          turns: []
        })
      }
    })
    installDsGui({
      runtimeRequest,
      workspaceDirectoryExists: vi.fn(async () => true)
    })
    Object.assign(window, {
      localStorage: {
        getItem: (key: string) => key === 'kun.codeWorkspaceFolderSets.v1'
          ? JSON.stringify({
              version: 1,
              sets: [{
                primary: '/Users/zxy/Code/frontend',
                extraRoots: ['/Users/zxy/Code/backend']
              }]
            })
          : null,
        setItem: () => undefined
      }
    })

    await expect(new KunRuntimeProvider().createThread({
      workspace: '/Users/zxy/Code/frontend'
    })).resolves.toMatchObject({
      id: 'thr_multi',
      additionalWorkspaces: ['/Users/zxy/Code/backend']
    })
  })

  it('updates additional workspaces through PATCH /v1/threads/{id}', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        id: 'thr/one',
        title: 'Frontend',
        workspace: '/Users/zxy/Code/frontend',
        additionalWorkspaces: ['/Users/zxy/Code/backend'],
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'idle',
        createdAt: 't0',
        updatedAt: 't1'
      })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.updateThreadAdditionalWorkspaces('thr/one', ['/Users/zxy/Code/backend']))
      .resolves.toMatchObject({
        id: 'thr/one',
        additionalWorkspaces: ['/Users/zxy/Code/backend']
      })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr%2Fone',
      'PATCH',
      JSON.stringify({ additionalWorkspaces: ['/Users/zxy/Code/backend'] })
    )
  })
})
