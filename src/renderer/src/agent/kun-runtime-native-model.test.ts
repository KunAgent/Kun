import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

function runtimeRequest() {
  const bodies: Record<string, unknown>[] = []
  const request = vi.fn(async (path: string, _method?: string, body?: string) => {
    if (path === '/v1/model-connections') return {
      ok: true, status: 200,
      body: JSON.stringify({
        schemaVersion: 1, revision: 1,
        providers: [{ id: 'http-main', accountId: 'http-account', configured: true, models: ['deepseek-chat'] }],
        defaultProviderId: 'http-main', defaultAccountId: 'http-account', defaultModel: 'deepseek-chat'
      })
    }
    const parsed = JSON.parse(body ?? '{}') as Record<string, unknown>
    bodies.push(parsed)
    return { ok: true, status: 201, body: JSON.stringify({
      id: 'thread-native', title: 'Native', workspace: '/tmp/workspace',
      model: parsed.model, mode: 'agent', status: 'idle',
      createdAt: 't0', updatedAt: 't0', turns: []
    }) }
  })
  installDsGui({ runtimeRequest: request, workspaceDirectoryExists: vi.fn(async () => true) })
  return bodies
}

describe('native harness thread model resolution', () => {
  it('uses the native default sentinel instead of Kun provider model/account', async () => {
    const bodies = runtimeRequest()
    await new KunRuntimeProvider().createThread({
      workspace: '/tmp/workspace', harnessId: 'codex', credentialMode: 'native-login'
    })
    expect(bodies[0]).toMatchObject({ harnessId: 'codex', credentialMode: 'native-login', model: 'default' })
    expect(bodies[0]).not.toHaveProperty('providerId')
    expect(bodies[0]).not.toHaveProperty('accountId')
  })

  it('keeps an explicitly selected native model', async () => {
    const bodies = runtimeRequest()
    await new KunRuntimeProvider().createThread({
      workspace: '/tmp/workspace', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.6-sol'
    })
    expect(bodies[0]?.model).toBe('gpt-5.6-sol')
  })

  it('preserves inherited project route provider absence and selected model', async () => {
    const bodies = runtimeRequest()
    await new KunRuntimeProvider().createThread({
      workspace: '/tmp/workspace', routeIntent: 'inherit', harnessId: 'kun', model: 'project-model',
      projectDefaultsRevision: 'ade-project-v1:abc'
    })
    expect(bodies[0]).toMatchObject({
      routeIntent: 'inherit', projectDefaultsRevision: 'ade-project-v1:abc', model: 'project-model'
    })
    expect(bodies[0]).not.toHaveProperty('providerId')
    expect(bodies[0]).not.toHaveProperty('accountId')
  })
})
