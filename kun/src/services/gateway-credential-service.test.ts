import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAesEncryptor } from '../security/secret-store.js'
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
    expect((await stat(service.directory)).mode & 0o777).toBe(0o700)
    expect((await stat(service.path)).mode & 0o777).toBe(0o600)
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
