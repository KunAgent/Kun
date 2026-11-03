import { describe, expect, it } from 'vitest'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import { kunAgent, ROUTE_POOL_LABEL } from './kun-routes.js'
import { resolveCodeRoute } from './model-catalog.js'

const provider = (id: string, kind: string, models: string[], extra: Record<string, unknown> = {}) =>
  ({ id, name: id.toUpperCase(), kind, configured: true, credentialStatus: 'ready', models, ...extra })
const pool = (id: string, modelId: string, targets: { providerId: string; modelId: string; enabled?: boolean }[], enabled = true) =>
  ({ id, name: id, modelId, enabled, strategy: 'priority', targets: targets.map((target, index) => ({ id: `${id}-${index}`, weight: 1, enabled: true, ...target })) })

function runtime(snapshot: Record<string, unknown>) {
  return {
    defaultModel: 'deepseek-chat',
    modelConnections: { snapshot: async () => ({ providers: [], routePools: [], ...snapshot }) },
    harnesses: { catalog: { list: () => [], get: () => undefined, isDisabled: () => false } }
  } as unknown as ServerRuntime
}

describe("Kun's own routes for the phone", () => {
  it('lists every connection kind Kun drives itself and leaves Agent accounts to their Agents', async () => {
    const kun = await kunAgent(runtime({
      providers: [
        provider('deepseek', 'http', ['deepseek-chat']),
        provider('gemini-cli', 'gemini-cli-api', ['gemini-3-pro']),
        provider('code-assist', 'gemini-code-assist', ['gemini-3-flash']),
        provider('claude-account', 'agent-sdk', ['claude-sonnet-4-5']),
        provider('cursor-account', 'cursor-sdk', ['composer-2']),
        provider('antigravity-account', 'antigravity-cli', ['gemini-3-pro']),
        provider('switched-off', 'http', ['x'], { enabled: false })
      ],
      defaultProviderId: 'gemini-cli',
      defaultModel: 'gemini-3-pro'
    }), [])
    expect(kun.routes.map((route) => route.providerId)).toEqual(['gemini-cli', 'deepseek', 'code-assist'])
    expect(kun.routes[0]).toMatchObject({ credentialMode: 'provider', label: 'GEMINI-CLI', defaultModel: 'gemini-3-pro' })
  })

  it('adds the route pools a usable target still serves as one "Kun API" route', async () => {
    const live = runtime({
      providers: [provider('deepseek', 'http', ['deepseek-chat']), provider('broken', 'http', ['glm-5'], { credentialStatus: 'missing' }),
        provider('claude-account', 'agent-sdk', ['claude-sonnet-4-5'])],
      routePools: [
        pool('fast', 'kun-fast', [{ providerId: 'DeepSeek', modelId: 'DEEPSEEK-CHAT' }]),
        pool('glm', 'kun-glm', [{ providerId: 'broken', modelId: 'glm-5' }]),
        pool('claude', 'kun-claude', [{ providerId: 'claude-account', modelId: 'claude-sonnet-4-5' }]),
        pool('off', 'kun-off', [{ providerId: 'deepseek', modelId: 'deepseek-chat' }], false),
        pool('member-off', 'kun-member-off', [{ providerId: 'deepseek', modelId: 'deepseek-chat', enabled: false }]),
        pool('unlisted', 'kun-unlisted', [{ providerId: 'deepseek', modelId: 'deepseek-v9' }])
      ],
      defaultProviderId: 'deepseek'
    })
    const kun = await kunAgent(live, [])
    expect(kun.routes.at(-1)).toEqual({ credentialMode: 'provider', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID, label: ROUTE_POOL_LABEL,
      models: ['kun-fast'], defaultModel: 'kun-fast' })
    // A pick on that route resolves exactly like the desktop's own Kun API pick.
    await expect(resolveCodeRoute(live, { harnessId: 'kun', credentialMode: 'provider', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID, model: 'kun-fast' }, []))
      .resolves.toEqual({ harnessId: 'kun', credentialMode: 'provider', providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID, model: 'kun-fast' })
  })

  it('puts the route pools first when they hold the default model', async () => {
    const kun = await kunAgent(runtime({
      providers: [provider('deepseek', 'http', ['deepseek-chat'])],
      routePools: [pool('fast', 'kun-fast', [{ providerId: 'deepseek', modelId: 'deepseek-chat' }]),
        pool('deep', 'kun-deep', [{ providerId: 'deepseek', modelId: 'deepseek-chat' }])],
      defaultProviderId: LOCAL_MODEL_GATEWAY_PROVIDER_ID,
      defaultModel: 'kun-deep'
    }), [])
    expect(kun.routes.map((route) => [route.providerId, route.defaultModel])).toEqual([
      [LOCAL_MODEL_GATEWAY_PROVIDER_ID, 'kun-deep'], ['deepseek', 'deepseek-chat']])
  })
})
