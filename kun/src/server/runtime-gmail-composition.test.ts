import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAesEncryptor } from '../security/secret-store.js'
import { EncryptedGmailStore } from '../gmail/store.js'
import { GoogleWorkspaceModelClient } from '../gmail/model-data-policy.js'
import { resolveGmailThreadDataState } from '../gmail/thread-data-state.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

const bootstrap = vi.hoisted(() => vi.fn())
vi.mock('../gmail/packaged-oauth-client.js', () => ({ bootstrapPackagedGmailOAuthClient: bootstrap }))
import { createRuntimeGmailComposition } from './runtime-gmail-composition.js'

const request = (threadId: string): ModelRequest => ({ threadId, turnId: 'test-turn', model: 'ordinary-model',
  tools: [], history: [], prefix: [], abortSignal: new AbortController().signal, stream: false })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('Gmail configuration failure keeps healthy classification', () => {
  for (const failure of ['missing', 'malformed'] as const) {
    it(`keeps ordinary model requests usable and mail access disabled when client config is ${failure}`, async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-config-classification-'))
      const encryptor = createAesEncryptor(randomBytes(32))
      const store = new EncryptedGmailStore(dataDir, encryptor)
      await store.update((state) => ({ ...state, sensitiveScopes: ['thread:mail-thread'] }))
      if (failure === 'missing') bootstrap.mockResolvedValueOnce(undefined)
      else bootstrap.mockRejectedValueOnce(new Error('Fake damaged publisher config'))
      const networkProxy = vi.fn(async () => '')
      const gmail = await createRuntimeGmailComposition({ core: { activeOptions: { dataDir } as KunServeRuntimeOptions },
        extensionCredentialKeyProvider: { encryptor }, networkProxy })
      const stream = vi.fn(async function* () { yield { kind: 'assistant_text_delta', text: 'ordinary reply' } as const })
      const model: ModelClient = { provider: 'test', model: 'ordinary-model', stream }
      const wrapped = new GoogleWorkspaceModelClient(model, {
        selection: async () => ({ model: 'ordinary-model' }),
        dataState: (threadId, history, recipient) => resolveGmailThreadDataState({ get: async () => null }, gmail, threadId, history, [], recipient)
      })
      try {
        expect(await collect(wrapped.stream(request('ordinary-thread')))).toEqual([{ kind: 'assistant_text_delta', text: 'ordinary reply' }])
        expect(stream).toHaveBeenCalledOnce()
        expect(await gmail.hasGoogleData('thread:mail-thread')).toBe(true)
        await expect(collect(wrapped.stream(request('mail-thread')))).rejects.toThrow()
        expect(stream).toHaveBeenCalledOnce()
        await gmail.markGoogleData('thread:derived-mail')
        expect(await gmail.hasGoogleData('thread:derived-mail')).toBe(true)
        expect(await gmail.status('thread:mail-thread')).toMatchObject({ configured: false, connected: false, allowModelSharing: false })
        await expect(gmail.startAuthorize({ scopeId: 'thread:mail-thread', allowModelSharing: true })).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
        await expect(gmail.setModelSharing('thread:mail-thread', true)).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
        await expect(gmail.read({ messageId: 'fake-message' }, 'thread:mail-thread')).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
        expect(networkProxy).not.toHaveBeenCalled()
      } finally { await gmail.dispose(); await rm(dataDir, { recursive: true, force: true }) }
    })
  }

  it('still blocks unknown history when the account store itself cannot be read', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-corrupt-classification-'))
    const encryptor = createAesEncryptor(randomBytes(32))
    await mkdir(join(dataDir, 'mcp-oauth'))
    await writeFile(join(dataDir, 'mcp-oauth', 'native-google-gmail.json'), '{invalid account data')
    bootstrap.mockRejectedValueOnce(new Error('Unavailable client config'))
    const gmail = await createRuntimeGmailComposition({ core: { activeOptions: { dataDir } as KunServeRuntimeOptions },
      extensionCredentialKeyProvider: { encryptor } })
    try {
      await expect(gmail.hasGoogleData('thread:ordinary-thread')).rejects.toMatchObject({ code: 'storage_unavailable' })
      expect(await gmail.status()).toMatchObject({ configured: false, connected: false, reconnectRequired: true })
    } finally { await gmail.dispose(); await rm(dataDir, { recursive: true, force: true }) }
  })
})
