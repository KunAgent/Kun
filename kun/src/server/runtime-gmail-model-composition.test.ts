import { afterEach, describe, expect, it, vi } from 'vitest'
import { GMAIL_CONVERSATION_RECIPIENT } from '../contracts/gmail.js'
import { createRuntimeGmailModelPolicy } from './runtime-gmail-model-composition.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { buildModelClientRouterInput } from './runtime-factory-model.js'
import { GoogleWorkspaceModelClient } from '../gmail/model-data-policy.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import type { GmailServicePort } from '../gmail/ports.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

vi.mock('../gmail/data-protection.js', () => ({ assertEncryptedGmailStorage: vi.fn(async () => undefined) }))
afterEach(() => vi.restoreAllMocks())
const request = (): ModelRequest => ({ threadId: 'mail-thread', turnId: 'turn', providerId: 'custom', model: 'custom-model',
  tools: [], history: [], prefix: [], abortSignal: new AbortController().signal, stream: false })
async function collect(stream: AsyncIterable<ModelStreamChunk>) { for await (const _chunk of stream) { /* drain */ } }

describe('normal Runtime Gmail model routing', () => {
  it('uses current normal credentials without loading Gmail vendor evidence or requiring a local model', async () => {
    const fetchModel = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [{ message: { content: 'Summary' }, finish_reason: 'stop' }] }))
    let sharing = true
    const status = vi.fn(async () => ({ configured: true, connected: true, reconnectRequired: false, scopes: [], allowModelSharing: sharing }))
    const gmail = { hasGoogleData: async () => true, markGoogleData: async () => undefined, status,
      captureModelSharingFence: () => () => { if (!sharing) throw new Error('Conversation sharing revoked') } } as unknown as GmailServicePort
    const threads = { get: async () => ({ id: 'mail-thread', model: 'custom-model', providerId: 'custom', turns: [] }) } as unknown as ThreadStore
    const options: KunServeRuntimeOptions = { host: '127.0.0.1', port: 0, runtimeToken: 'fixture-runtime-token',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
      dataDir: '/protected-test-data', apiKey: '', baseUrl: 'https://any-configured.example/v1', model: 'custom-model',
      activeProviderId: 'custom', providers: { custom: { kind: 'http', apiKey: '', credentialSourceId: 'model-connection:custom',
        baseUrl: 'https://any-configured.example/v1', endpointFormat: 'chat_completions', models: ['custom-model'] } } }
    const credentials = vi.fn(async () => ({ apiKey: 'current-protected-fixture-key', refreshable: false }))
    const clients = buildModelClientRouterInput(options, (id) => ({ id, inputModalities: ['text'], outputModalities: ['text'],
      supportsToolCalling: true, messageParts: ['text'] }), undefined, credentials)
    const policy = createRuntimeGmailModelPolicy({ threads, gmail, dataDir: options.dataDir,
      fallback: () => ({ model: 'custom-model', providerId: 'custom' }) })
    const model = new GoogleWorkspaceModelClient(new MultiProviderModelClient(clients), policy)
    expect(await model.availability('mail-thread')).toMatchObject({ allowed: true, recipientBinding: GMAIL_CONVERSATION_RECIPIENT })
    await collect(model.stream(request()))
    expect(fetchModel).toHaveBeenCalledOnce()
    expect(new Headers(fetchModel.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer current-protected-fixture-key')
    expect(assertEncryptedGmailStorage).toHaveBeenCalledWith(options.dataDir)
    sharing = false
    await expect(collect(model.stream({ ...request(), turnId: 'after-revoke' }))).rejects.toThrow('Enable Gmail sharing')
    expect(fetchModel).toHaveBeenCalledOnce()
  })
})
