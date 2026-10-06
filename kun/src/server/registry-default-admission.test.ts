import { describe, expect, it, vi } from 'vitest'
import { buildModelClientRouterInput } from './runtime-factory-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { ModelStreamChunk } from '../ports/model-client.js'

describe('Registry-owned default model admission', () => {
  it('never reuses an old credential resolver or anonymous endpoint after the default connection is paused', async () => {
    const resolveCredential = vi.fn(async () => ({ apiKey: 'old-secret', refreshable: false }))
    const options: KunServeRuntimeOptions = { host: '127.0.0.1', port: 0, dataDir: '/tmp/kun-provider-fixture',
      runtimeToken: 'test', apiKey: 'stale-secret', credentialSourceId: 'model-connection:paused',
      baseUrl: 'http://127.0.0.1:9999/v1', model: 'model', approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
      modelConnectionSelectionRequired: true, providers: {} }
    const clients = buildModelClientRouterInput(options, () => ({ id: 'model', inputModalities: ['text'],
      outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: false }), undefined, resolveCredential)
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of clients.default.stream({ model: 'model', threadId: 'thread', turnId: 'turn',
      prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })) chunks.push(chunk)
    expect(chunks).toEqual([expect.objectContaining({ kind: 'error', code: 'model_connection_unavailable' })])
    expect(resolveCredential).not.toHaveBeenCalled()
    expect(clients.gatewayClients.size).toBe(0)
  })
})
