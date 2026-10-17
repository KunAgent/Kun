import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { createAesEncryptor } from '../security/secret-store.js'
import { NativeGmailService } from './service.js'
import { KUN_GMAIL_CLIENT_ID } from './ports.js'
import { EncryptedGmailOAuthClientStore, parseDownloadedGmailOAuthClient } from './oauth-client-config.js'

const SECRET = 'fake-desktop-oauth-configuration'
const temporary: string[] = []
afterEach(async () => {
  configureManagerAtomicJsonClient(null)
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'kun-gmail-desktop-client-'))
  temporary.push(path)
  return path
}

describe('fixed Kun Desktop OAuth configuration', () => {
  it('accepts only the reviewed Desktop client credentials and fixed Google endpoints', () => {
    const downloaded = { installed: { client_id: KUN_GMAIL_CLIENT_ID, client_secret: SECRET,
      project_id: 'kunagent-510206', auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs', redirect_uris: ['http://localhost'] } }
    expect(parseDownloadedGmailOAuthClient(downloaded)).toBe(SECRET)
    for (const invalid of [
      { web: downloaded.installed },
      { installed: { ...downloaded.installed, client_id: 'other-client.apps.googleusercontent.com' } },
      { installed: { ...downloaded.installed, token_uri: 'https://example.com/token' } },
      { installed: { ...downloaded.installed, client_secret: 'bad\nSECRET' } },
      { installed: { ...downloaded.installed, extra: SECRET } }
    ]) {
      try { parseDownloadedGmailOAuthClient(invalid); throw new Error('Should reject invalid credentials') }
      catch (error) { expect(error).toMatchObject({ code: 'client_configuration_invalid' }); expect(String(error)).not.toContain(SECRET) }
    }
  })

  it('requires Manager ownership for installation and refuses plaintext credential files', async () => {
    const dataDir = await directory()
    const store = new EncryptedGmailOAuthClientStore(dataDir, createAesEncryptor(randomBytes(32)))
    expect(await store.read()).toBeUndefined()
    await expect(store.install(SECRET)).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
    await mkdir(join(dataDir, 'mcp-oauth'))
    const path = join(dataDir, 'mcp-oauth', 'native-google-gmail-client.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 1, clientSecret: SECRET }))
    const failure = await store.read().catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'client_configuration_unavailable' })
    expect(String(failure)).not.toContain(SECRET)
    expect(await readFile(path, 'utf8')).toContain(SECRET)
  })

  it('persists only ciphertext through Manager and keeps decrypted credentials inside the host', async () => {
    const dataDir = await directory()
    let value: unknown = null
    let revision = 0
    const records: unknown[] = []
    const manager = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const mutation = JSON.parse(body) as { value?: unknown; expectedRevision?: number }
      if (request.url?.endsWith('/write')) {
        records.push(mutation.value)
        if (mutation.expectedRevision !== revision) { response.writeHead(409); response.end('{"code":"revision_conflict"}'); return }
        value = mutation.value
        revision += 1
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ snapshot: { revision, value } }))
    })
    await new Promise<void>((resolve) => manager.listen(0, '127.0.0.1', resolve))
    const port = (manager.address() as AddressInfo).port
    configureManagerAtomicJsonClient({ dataDir, baseUrl: `http://127.0.0.1:${port}`, token: 'test-manager-owner' })
    try {
      const encryptor = createAesEncryptor(randomBytes(32))
      const store = new EncryptedGmailOAuthClientStore(dataDir, encryptor)
      const result = await store.install(SECRET, '2026-10-13T08:00:00.000Z')
      expect(result).toEqual({ clientId: KUN_GMAIL_CLIENT_ID, installedAt: '2026-10-13T08:00:00.000Z' })
      expect(JSON.stringify(records)).not.toContain(SECRET)
      expect(JSON.stringify(records)).not.toContain(KUN_GMAIL_CLIENT_ID)
      expect(await store.read()).toMatchObject({ clientId: KUN_GMAIL_CLIENT_ID, clientSecret: SECRET })
      const wrongKey = new EncryptedGmailOAuthClientStore(dataDir, createAesEncryptor(randomBytes(32)))
      await expect(wrongKey.read()).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
    } finally {
      configureManagerAtomicJsonClient(null)
      await new Promise<void>((resolve) => manager.close(() => resolve()))
    }
  })

  it('prevents a production authorization attempt when the Desktop client configuration is absent', async () => {
    const dataDir = await directory()
    const openExternal = vi.fn(async () => undefined)
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new NativeGmailService({ dataDir, encryptor: createAesEncryptor(randomBytes(32)),
      requireClientSecret: true, openExternal, fetchImpl })
    try {
      expect(await service.status()).toMatchObject({ configured: false, connected: false })
      await expect(service.startAuthorize({ scopeId: 'thread:missing-config', allowModelSharing: false }))
        .rejects.toMatchObject({ code: 'client_configuration_required' })
      expect(openExternal).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally { await service.dispose() }
  })
})
