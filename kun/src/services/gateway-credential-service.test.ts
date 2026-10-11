import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAesEncryptor } from '../security/secret-store.js'
import { localModelGatewayApplyIssue } from '../server/runtime-factory-config.js'
import { GatewayCredentialService } from './gateway-credential-service.js'

const directories: string[] = []

async function createService(): Promise<{ service: GatewayCredentialService; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-gateway-credential-'))
  directories.push(dataDir)
  const service = new GatewayCredentialService(dataDir, createAesEncryptor(randomBytes(32)))
  await service.initialize()
  return { service, dataDir }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('GatewayCredentialService', () => {
  it('creates a CSPRNG bearer and stores only encrypted data with 0700/0600 permissions', async () => {
    const { service } = await createService()
    const { key, created } = await service.ensure()
    expect(created).toBe(true)
    expect(key).toMatch(/^kun_local_[A-Za-z0-9_-]{43}$/)
    if (process.platform !== 'win32') {
      expect((await stat(service.directory)).mode & 0o777).toBe(0o700)
      expect((await stat(service.path)).mode & 0o777).toBe(0o600)
    }
    expect(await readFile(service.path, 'utf8')).not.toContain(key)
  })

  it('generates independent credentials for independent runtime data directories', async () => {
    const first = await createService()
    const second = await createService()
    expect((await first.service.ensure()).key).not.toBe((await second.service.ensure()).key)
  })

  it('rotates atomically and invalidates the previous bearer', async () => {
    const { service } = await createService()
    const previous = (await service.ensure()).key
    const current = (await service.rotate()).key
    expect(current).not.toBe(previous)
    expect(service.verify(previous)).toBe(false)
    expect(service.verify(current)).toBe(true)
    expect(await readFile(service.path, 'utf8')).not.toContain(current)
  })

  it('revokes the bearer and removes its encrypted record', async () => {
    const { service } = await createService()
    const key = (await service.ensure()).key
    await expect(service.revoke()).resolves.toBe(true)
    expect(service.verify(key)).toBe(false)
    expect(service.status()).toEqual({ configured: false })
    await expect(stat(service.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('durable per-client gateway credentials', () => {
  it('restores identities across restart, encrypts keys and never lists secrets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gateway-clients-'))
    directories.push(dataDir)
    const encryptor = createAesEncryptor(randomBytes(32))
    const first = new GatewayCredentialService(dataDir, encryptor)
    await first.initialize()
    const { client, key } = await first.createClient('Editor')
    expect(first.hasKey()).toBe(false)
    expect(first.hasActiveCredentials()).toBe(true)
    expect(first.identify(key)).toEqual({ clientId: client.clientId, name: 'Editor', credentialKind: 'client' })
    expect(first.listClients()).toEqual([client])
    expect(JSON.stringify(first.listClients())).not.toContain(key)
    const stored = await readFile(first.clientsPath, 'utf8')
    expect(stored).not.toContain(key)
    expect(stored).not.toContain('Editor')
    if (process.platform !== 'win32') expect((await stat(first.clientsPath)).mode & 0o777).toBe(0o600)
    const restarted = new GatewayCredentialService(dataDir, encryptor)
    await restarted.initialize()
    expect(restarted.identify(key)).toEqual(first.identify(key))
    expect(restarted.listClients()).toEqual([client])
    await restarted.revokeClient(client.clientId)
    expect(restarted.verify(key)).toBe(false)
    const afterRevocation = new GatewayCredentialService(dataDir, encryptor)
    await afterRevocation.initialize()
    expect(afterRevocation.verify(key)).toBe(false)
    expect(afterRevocation.listClients()[0]).toMatchObject({ clientId: client.clientId, revokedAt: expect.any(String) })
  })

  it('serializes concurrent creates and only revokes the selected credential', async () => {
    const { service } = await createService()
    const shared = (await service.ensure()).key
    const [one, two] = await Promise.all([service.createClient('One'), service.createClient('Two')])
    expect(service.listClients()).toHaveLength(2)
    await service.revokeClient(one.client.clientId)
    expect(service.verify(one.key)).toBe(false)
    expect(service.verify(two.key)).toBe(true)
    expect(service.verify(shared)).toBe(true)
    await service.rotate()
    expect(service.verify(one.key)).toBe(false)
    await service.revoke()
    expect(service.hasKey()).toBe(false)
    expect(service.hasActiveCredentials()).toBe(true)
    expect(service.verify(two.key)).toBe(true)
    expect(await service.revokeClient(one.client.clientId)).toBe(false)
  })

  it('allows enabling and hot apply with client credentials after the shared key is revoked', async () => {
    const { service } = await createService()
    await service.ensure()
    const { client } = await service.createClient('Only client')
    await service.revoke()
    const options = { host: '127.0.0.1', localModelGateway: { enabled: true, exposeProviderModels: false } }
    expect(service.status()).toEqual({ configured: false })
    expect(localModelGatewayApplyIssue(options, service)).toBeNull()
    await service.revokeClient(client.clientId)
    expect(localModelGatewayApplyIssue(options, service)).toMatchObject({ code: 'gateway_key_missing' })
  })

  it('rejects malformed names and fails closed with the wrong encryption key', async () => {
    const { service, dataDir } = await createService()
    await expect(service.createClient('')).rejects.toThrow('Client name')
    await expect(service.createClient('bad\nname')).rejects.toThrow('Client name')
    await expect(service.createClient('x'.repeat(81))).rejects.toThrow('Client name')
    await service.createClient('Valid')
    const wrong = new GatewayCredentialService(dataDir, createAesEncryptor(randomBytes(32)))
    await expect(wrong.initialize()).rejects.toThrow()
    expect(wrong.hasActiveCredentials()).toBe(false)
  })
})
