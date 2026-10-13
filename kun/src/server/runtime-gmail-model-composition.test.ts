import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekAccountEvidenceStore } from '../gmail/deepseek-account-evidence.js'
import { createAesEncryptor } from '../security/secret-store.js'
import { GoogleWorkspaceModelClient } from '../gmail/model-data-policy.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import type { GmailModelRecipientBinding } from '../contracts/gmail.js'
import type { GmailServicePort } from '../gmail/ports.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { buildGmailModelClientRouterInput, createRuntimeGmailModelPolicy, prepareGmailModelClientEvidence } from './runtime-gmail-model-composition.js'

vi.mock('../gmail/data-protection.js', () => ({ assertEncryptedGmailStorage: vi.fn(async () => undefined) }))
const MODEL = 'deepseek-chat'
const API_KEY = 'reviewed-fixture-key'
const capabilities: Parameters<typeof buildGmailModelClientRouterInput>[1] = (id) => ({ id, inputModalities: ['text'],
  outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true })
const request = (): ModelRequest => ({ threadId: 'mail-thread', turnId: 'turn', providerId: 'deepseek',
  model: MODEL, tools: [], history: [], prefix: [], abortSignal: new AbortController().signal,
  maxRetryAttempts: 0, stream: false })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('production Gmail model composition', () => {
  let dataDir: string
  let store: DeepSeekAccountEvidenceStore
  let options: KunServeRuntimeOptions
  let currentKey: string
  let approvedRecipient: GmailModelRecipientBinding | undefined
  let fetchModel: ReturnType<typeof vi.spyOn>
  const resolveCredential = vi.fn(async () => ({ apiKey: currentKey, refreshable: false }))
  const gmailStatus = vi.fn(async (_scope: string, recipient?: GmailModelRecipientBinding) => ({
    configured: true, connected: true, reconnectRequired: false,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    allowModelSharing: !!recipient && !!approvedRecipient && recipient.id === approvedRecipient.id &&
      recipient.accountBinding === approvedRecipient.accountBinding
  }))
  const gmail = { hasGoogleData: async () => true, markGoogleData: async () => undefined,
    captureModelSharingFence: () => () => undefined,
    status: gmailStatus } as unknown as GmailServicePort
  const threads = { get: async () => ({ id: 'mail-thread', model: MODEL, providerId: 'deepseek', turns: [] }) } as unknown as ThreadStore
  const policy = (localClient?: ModelClient) => createRuntimeGmailModelPolicy({ threads, gmail, dataDir,
    fallback: () => ({ model: MODEL, providerId: 'deepseek' }), localClient })
  const build = () => buildGmailModelClientRouterInput(options, capabilities, store, undefined, resolveCredential)
  const install = () => store.install({ apiKey: API_KEY, source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })

  beforeEach(async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', ''); vi.stubEnv('KUN_MANAGER_TOKEN', ''); vi.stubEnv('KUN_MANAGER_DATA_DIR', '')
    dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-composition-'))
    store = new DeepSeekAccountEvidenceStore(dataDir, createAesEncryptor(randomBytes(32)))
    currentKey = API_KEY; approvedRecipient = undefined
    resolveCredential.mockClear(); gmailStatus.mockClear(); vi.mocked(assertEncryptedGmailStorage).mockClear()
    options = { host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'fixture-runtime-token',
      activeProviderId: 'deepseek', apiKey: 'stale-inline-key', credentialSourceId: 'model-connection:deepseek',
      baseUrl: 'https://api.deepseek.com', model: MODEL, endpointFormat: 'chat_completions',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
      providers: { deepseek: { apiKey: 'stale-inline-key', credentialSourceId: 'model-connection:deepseek',
        baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions', models: [MODEL] } } }
    fetchModel = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      id: 'fixture-response', model: MODEL, choices: [{ message: { content: 'Requested email summary' }, finish_reason: 'stop' }]
    }))
  })
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dataDir, { recursive: true, force: true }) })

  it('denies Gmail without an account review while leaving ordinary model transport usable', async () => {
    const clients = await build()
    const model = new GoogleWorkspaceModelClient(new MultiProviderModelClient(clients), policy())
    expect(await model.availability('mail-thread')).toMatchObject({ allowed: false, recipient: 'deepseek-api' })
    await expect(collect(model.stream(request()))).rejects.toThrow('training opt-out')
    expect(fetchModel).not.toHaveBeenCalled()
    await collect(clients.providers.get('deepseek')!.stream(request()))
    expect(fetchModel).toHaveBeenCalledOnce()
    expect(new Headers(fetchModel.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('uses the managed credential and requires the explicit cloud-recipient grant', async () => {
    await install()
    const publicOptions = structuredClone(options)
    const clients = await build()
    expect(resolveCredential).toHaveBeenCalledOnce()
    const model = new GoogleWorkspaceModelClient(new MultiProviderModelClient(clients), policy())
    const available = await model.availability('mail-thread')
    expect(available).toMatchObject({ allowed: true, recipient: 'deepseek-api', endpoint: 'https://api.deepseek.com' })
    expect(resolveCredential).toHaveBeenCalledWith('model-connection:deepseek')
    approvedRecipient = { id: 'kun-managed-local', accountBinding: 'kun-managed-local:v1' }
    await expect(collect(model.stream(request()))).rejects.toThrow('exact model account')
    expect(fetchModel).not.toHaveBeenCalled()
    approvedRecipient = available.recipientBinding
    await collect(model.stream(request()))
    expect(fetchModel).toHaveBeenCalledOnce()
    expect(fetchModel.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(new Headers(fetchModel.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(gmailStatus).toHaveBeenCalledWith('thread:mail-thread', approvedRecipient)
    expect(assertEncryptedGmailStorage).toHaveBeenCalledWith(dataDir)
    expect(options).not.toHaveProperty('googleWorkspaceAccountEvidence')
    expect(options.providers!.deepseek).not.toHaveProperty('googleWorkspaceAccountEvidence')
    expect(options).toEqual(publicOptions)
    expect(options.apiKey).toBe('stale-inline-key')
    expect(options.providers!.deepseek.apiKey).toBe('stale-inline-key')
  })

  it('refuses a changed managed credential before dispatch and after rebuilding transports', async () => {
    await install()
    const clients = await build()
    const direct = new MultiProviderModelClient(clients)
    const model = new GoogleWorkspaceModelClient(direct, policy())
    approvedRecipient = (await model.availability('mail-thread')).recipientBinding
    currentKey = 'different-api-account-key'
    const chunks = await collect(model.stream(request()))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(fetchModel).not.toHaveBeenCalled()
    const captured = direct.googleWorkspaceDispatchGuard(request())
    direct.replace(await build())
    expect(() => captured()).toThrow('changed')
    expect(await model.availability('mail-thread')).toMatchObject({ allowed: false })
  })

  it('pins the default transport to the same reviewed managed account', async () => {
    await install()
    const clients = await build()
    const model = new GoogleWorkspaceModelClient(new MultiProviderModelClient(clients), policy())
    approvedRecipient = (await model.availability('mail-thread', { model: MODEL })).recipientBinding
    await collect(model.stream({ ...request(), providerId: undefined }))
    expect(fetchModel).toHaveBeenCalledOnce()
    expect(new Headers(fetchModel.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(options.apiKey).toBe('stale-inline-key')
  })

  it('hides credential-store errors and does not dispatch a reviewed mail request', async () => {
    await install()
    const clients = await build()
    const model = new GoogleWorkspaceModelClient(new MultiProviderModelClient(clients), policy())
    approvedRecipient = (await model.availability('mail-thread')).recipientBinding
    resolveCredential.mockRejectedValueOnce(new Error(`Protected store failure: ${API_KEY}`))
    const chunks = await collect(model.stream(request()))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(JSON.stringify(chunks)).not.toContain(API_KEY)
    expect(fetchModel).not.toHaveBeenCalled()
  })

  it('rechecks the endpoint on hot rebuild and does not approve a lookalike destination', async () => {
    await install()
    const clients = await build()
    const direct = new MultiProviderModelClient(clients)
    const captured = direct.googleWorkspaceDispatchGuard(request())
    options = { ...options, baseUrl: 'https://api.deepseek.com.attacker.test', providers: { deepseek: {
      ...options.providers!.deepseek, baseUrl: 'https://api.deepseek.com.attacker.test' } } }
    direct.replace(await build())
    expect(() => captured()).toThrow('changed')
    expect(await new GoogleWorkspaceModelClient(direct, policy()).availability('mail-thread')).toMatchObject({ allowed: false })
    expect(fetchModel).not.toHaveBeenCalled()
  })

  it('fails closed for unreadable evidence without emitting a credential-bearing error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = { proof: vi.fn(async () => { throw new Error('unreadable protected fixture credential') }) }
    const evidence = await prepareGmailModelClientEvidence(options, failed, resolveCredential)
    expect(evidence.default).toBeUndefined()
    expect(evidence.providers.size).toBe(0)
    expect(error).not.toHaveBeenCalled()
  })

  it('preserves the host-created local client independently of the DeepSeek review', () => {
    const local: ModelClient = { provider: 'local', model: 'qwen3:4b', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } }
    expect(policy(local).local).toEqual({ providerId: 'kun-gmail-local', model: 'qwen3:4b', client: local })
  })
})
