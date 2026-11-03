import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withModelVerification } from './model-verification-client.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ModelClient, ModelRequest } from '../ports/model-client.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const request: ModelRequest = { abortSignal: new AbortController().signal, threadId: 't', turnId: 'u', model: 'one', providerId: 'private', systemPrompt: '', prefix: [], history: [], tools: [], stream: true }
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-inference-evidence-')); directories.push(dataDir)
  const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
  await registry.initialize()
  await registry.connect({ expectedRevision: 0, id: 'private', name: 'Private', kind: 'http', authType: 'api-key',
    baseUrl: 'https://provider.test/v1', endpointFormat: 'responses', models: ['one', 'two'], credential: 'test-key', probe: false, select: false })
  return registry
}
async function drain(client: ModelClient) { for await (const chunk of client.stream(request)) void chunk }
describe('inference catalog evidence', () => {
  it('records successful and failed attempts for the exact model and protocol independently', async () => {
    const registry = await fixture()
    await drain(withModelVerification({ provider: 'test', model: 'one', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } }, 'private', () => registry, () => 'messages'))
    expect((await registry.catalog('private'))?.modelVerification?.['one:messages']).toMatchObject({ model: 'one', protocol: 'messages', lastSuccessAt: expect.any(String) })
    await drain(withModelVerification({ provider: 'test', model: 'one', async *stream() { yield { kind: 'completed', stopReason: 'stop' } } }, 'private', () => registry))
    await drain(withModelVerification({ provider: 'test', model: 'one', async *stream() { yield { kind: 'error', message: 'Failure', code: 'model' } } }, 'private', () => registry))
    const catalog = await registry.catalog('private')
    expect(catalog?.modelVerification?.['one:responses']).toMatchObject({ model: 'one', protocol: 'responses', lastSuccessAt: expect.any(String), lastFailureAt: expect.any(String), reason: 'model' })
    expect(catalog?.modelVerification?.['two:responses']).toBeUndefined()
    expect(catalog?.modelProfiles).toBeUndefined()
  })
  it('rejects stale account-scoped capabilities before dispatch and refreshes Runtime metadata', async () => {
    const registry = await fixture()
    let dispatched = false
    const client = withModelVerification({ provider: 'test', model: 'one', async *stream() {
      dispatched = true; yield { kind: 'completed', stopReason: 'stop' }
    } }, 'private', () => registry, undefined, () => ['different-account'])
    const chunks = []
    for await (const chunk of client.stream(request)) chunks.push(chunk)
    expect(dispatched).toBe(false)
    expect(chunks).toMatchObject([{ kind: 'error', code: 'provider_account_changed' }])
  })
  it('does not validate a replacement account with the preceding account response', async () => {
    const registry = await fixture()
    await drain(withModelVerification({ provider: 'test', model: 'one', async *stream() {
      await registry.replaceCredential('private', { expectedRevision: (await registry.snapshot()).revision, credential: 'new-key' })
      yield { kind: 'completed', stopReason: 'stop' }
    } }, 'private', () => registry))
    expect((await registry.catalog('private'))?.modelVerification).toBeUndefined()
  })
})
