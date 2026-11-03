import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { createAesEncryptor } from '../security/secret-store.js'
import { EncryptedGmailOAuthClientStore, parsePackagedGmailOAuthClient } from './oauth-client-config.js'
import { KUN_GMAIL_CLIENT_ID } from './ports.js'
import { bootstrapPackagedGmailOAuthClient, readPackagedGmailOAuthClient } from './packaged-oauth-client.js'

const CONFIG = { schemaVersion: 1, distribution: 'kun-desktop-macos',
  clientId: KUN_GMAIL_CLIENT_ID, clientSecret: 'fake-publisher-native-client-secret' } as const

describe('fixed packaged native Gmail client resource', () => {
  it('rejects wrong clients, unexpected fields, invalid secrets and oversized files without diagnostics containing credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-packaged-gmail-config-'))
    const file = join(directory, 'gmail-native-client.json')
    try {
      expect(await readPackagedGmailOAuthClient(pathToFileURL(file))).toBeUndefined()
      await writeFile(file, JSON.stringify(CONFIG))
      expect(await readPackagedGmailOAuthClient(pathToFileURL(file))).toEqual(CONFIG)
      for (const value of [{ ...CONFIG, clientId: 'other-client' }, { ...CONFIG, endpoint: 'https://example.com' },
        { ...CONFIG, clientSecret: 'short' }, { ...CONFIG, distribution: 'other-app' }]) {
        await writeFile(file, JSON.stringify(value))
        const error = await readPackagedGmailOAuthClient(pathToFileURL(file)).catch((failure: unknown) => failure)
        expect(error).toMatchObject({ code: 'client_configuration_unavailable' })
        expect(String(error)).not.toContain(CONFIG.clientSecret)
      }
      await writeFile(file, ' '.repeat(16_385))
      await expect(readPackagedGmailOAuthClient(pathToFileURL(file))).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
      await symlink(file, join(directory, 'redirect.json'))
      await expect(readPackagedGmailOAuthClient(pathToFileURL(join(directory, 'redirect.json')))).rejects.toMatchObject({ code: 'client_configuration_unavailable' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('automatically bootstraps and rotates only the fixed native configuration through Manager ciphertext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-packaged-gmail-manager-'))
    let persisted: unknown = null
    let revision = 0
    const mutations: unknown[] = []
    const manager = createServer(async (request, response) => {
      let text = ''
      for await (const chunk of request) text += String(chunk)
      const value = JSON.parse(text) as { expectedRevision: number; value: unknown }
      if (request.url?.endsWith('/write')) {
        if (value.expectedRevision !== revision) { response.writeHead(409); response.end('{"code":"revision_conflict"}'); return }
        persisted = value.value
        mutations.push(value.value)
        revision += 1
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ snapshot: { revision, value: persisted } }))
    })
    await new Promise<void>((resolve) => manager.listen(0, '127.0.0.1', resolve))
    configureManagerAtomicJsonClient({ dataDir: directory,
      baseUrl: `http://127.0.0.1:${(manager.address() as AddressInfo).port}`, token: 'test-owner' })
    try {
      const store = new EncryptedGmailOAuthClientStore(directory, createAesEncryptor(randomBytes(32)))
      const protection = vi.fn(async () => undefined)
      const packaged = parsePackagedGmailOAuthClient(CONFIG)
      const dependencies = { platform: 'darwin' as const, readConfiguration: async () => packaged }
      expect(await bootstrapPackagedGmailOAuthClient({ store, assertDataProtection: protection }, dependencies))
        .toMatchObject({ clientId: KUN_GMAIL_CLIENT_ID, clientSecret: CONFIG.clientSecret })
      expect(protection).toHaveBeenCalledOnce()
      expect(mutations).toHaveLength(1)
      expect(JSON.stringify(mutations)).not.toContain(CONFIG.clientSecret)
      await bootstrapPackagedGmailOAuthClient({ store, assertDataProtection: protection }, dependencies)
      expect(mutations).toHaveLength(1)
      const changed = { ...packaged, clientSecret: 'fake-publisher-rotated-client-secret' }
      await bootstrapPackagedGmailOAuthClient({ store, assertDataProtection: protection },
        { ...dependencies, readConfiguration: async () => changed })
      expect(await store.read()).toMatchObject({ clientSecret: changed.clientSecret })
      expect(mutations).toHaveLength(2)
      expect(JSON.stringify(mutations)).not.toContain(changed.clientSecret)
    } finally {
      configureManagerAtomicJsonClient(null)
      await new Promise<void>((resolve) => manager.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves disabled builds alone and does not access a macOS package resource on other platforms', async () => {
    const read = vi.fn(async () => undefined)
    const install = vi.fn(async () => ({ clientId: KUN_GMAIL_CLIENT_ID, installedAt: new Date().toISOString() }))
    const store = { read, install } as unknown as EncryptedGmailOAuthClientStore
    const readConfiguration = vi.fn(async () => undefined)
    const assertDataProtection = vi.fn(async () => undefined)
    expect(await bootstrapPackagedGmailOAuthClient({ store, assertDataProtection }, { platform: 'darwin', readConfiguration })).toBeUndefined()
    expect(readConfiguration).toHaveBeenCalledOnce()
    readConfiguration.mockClear()
    expect(await bootstrapPackagedGmailOAuthClient({ store, assertDataProtection }, { platform: 'win32', readConfiguration })).toBeUndefined()
    expect(readConfiguration).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(assertDataProtection).not.toHaveBeenCalled()
  })

  it('fails closed before mutation when storage protection or prior encrypted configuration fails', async () => {
    const install = vi.fn()
    const read = vi.fn(async () => undefined)
    const store = { read, install } as unknown as EncryptedGmailOAuthClientStore
    const dependencies = { platform: 'darwin' as const, readConfiguration: vi.fn(async () => parsePackagedGmailOAuthClient(CONFIG)) }
    await expect(bootstrapPackagedGmailOAuthClient({ store, assertDataProtection: async () => { throw new Error('Protected volume required') } }, dependencies))
      .rejects.toThrow('Protected volume required')
    expect(install).not.toHaveBeenCalled()
    read.mockRejectedValueOnce(new Error('Existing encrypted credentials could not be opened'))
    dependencies.readConfiguration.mockClear()
    await expect(bootstrapPackagedGmailOAuthClient({ store, assertDataProtection: async () => undefined }, dependencies))
      .rejects.toThrow('Existing encrypted credentials could not be opened')
    expect(dependencies.readConfiguration).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })
})
