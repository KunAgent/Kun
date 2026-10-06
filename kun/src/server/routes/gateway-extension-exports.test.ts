import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayChatCompletions, gatewayModels } from './openai-model-gateway.js'

class Recorder implements ModelClient {
  provider = 'fake'
  model = 'fake'
  last?: ModelRequest
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.last = request
    yield { kind: 'assistant_text_delta', text: 'ok' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function runtime(model: ModelClient, exports: { providerId: string; accountId: string }[], declared = true): ServerRuntime {
  return {
    modelClient: model,
    modelConnections: { snapshot: async () => ({ revision: 1, providers: [] }) },
    extensionPlatform: { modelProviders: { gatewayExportable: () => declared
      ? [{ providerId: 'ext.acme/acme', extensionId: 'acme', displayName: 'Acme', models: [{ id: 'acme-1', displayName: 'Acme One' }] }] : [] } },
    modelGateway: { enabled: () => true, exposeProviderModels: () => true, credentials: { verify: (value: string | null) => value === 'k' },
      pools: () => [], extensionExports: () => exports }
  } as unknown as ServerRuntime
}

const get = (rt: ServerRuntime) => gatewayModels(rt, new Request('http://x/v1/models', { headers: { authorization: 'Bearer k' } }))
  .then((response) => (JSON.parse((response as { body: string }).body) as { data: { id: string; display_name?: string }[] }).data)

describe('extension provider export', () => {
  it('lists and serves a declared provider only after an account is chosen, binding that account', async () => {
    expect(await get(runtime(new Recorder(), []))).toEqual([])
    expect(await get(runtime(new Recorder(), [{ providerId: 'ext.acme/acme', accountId: 'acct' }], false))).toEqual([])
    const recorder = new Recorder()
    const rt = runtime(recorder, [{ providerId: 'ext.acme/acme', accountId: 'acct' }])
    expect(await get(rt)).toEqual([expect.objectContaining({ id: 'ext.acme/acme/acme-1', display_name: 'Acme One · Acme' })])
    const response = await gatewayChatCompletions(rt, new Request('http://x/v1/chat/completions', { method: 'POST',
      headers: { authorization: 'Bearer k' }, body: JSON.stringify({ model: 'ext.acme/acme/acme-1', messages: [{ role: 'user', content: 'hi' }] }) }))
    expect((response as { status: number }).status).toBe(200)
    expect(recorder.last).toMatchObject({ model: 'acme-1', providerId: 'ext.acme/acme', accountId: 'acct' })
  })
})
