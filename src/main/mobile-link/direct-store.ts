import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile, rename, lstat, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { directAddresses } from '@kun/remote-protocol'
import { MOBILE_LINK_SCOPES } from '../../shared/mobile-link-scopes'
import { emptyDirectSettings, type DirectSettings } from './direct-registry'

export const DirectConfiguration = z.object({ enabled: z.boolean(), bind: z.enum(['lan', 'loopback']), port: z.number().int().min(0).max(65535),
  addresses: z.array(z.string().min(1).max(2048)).max(6), iceServers: z.array(z.object({
    urls: z.union([z.string(), z.array(z.string()).min(1).max(4)]), username: z.string().max(512).optional(), credential: z.string().max(1024).optional()
  }).strict()).max(8).optional() }).strict()
const Stored = DirectConfiguration.extend({ grants: z.array(z.object({ id: z.string().uuid(), secret: z.string().regex(/^[a-f0-9]{64}$/),
  deviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), name: z.string().min(1).max(180),
  scopes: z.array(z.enum(MOBILE_LINK_SCOPES)).max(MOBILE_LINK_SCOPES.length), expiresAt: z.number().int().positive() }).strict()).max(16) }).strict()
export function directConfiguration(value: unknown) {
  const input = DirectConfiguration.parse(value)
  const addresses = input.addresses.length ? directAddresses(input.addresses) : []
  for (const server of input.iceServers ?? []) for (const url of typeof server.urls === 'string' ? [server.urls] : server.urls)
    if (url.length > 2048 || !/^(stun|stuns|turn|turns):[^\s@]+$/i.test(url)) throw Error('INVALID_ICE_SERVER')
  return { ...input, addresses }
}
async function available() {
  if (!(process.platform === 'darwin' ? await safeStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable()) ||
      process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) throw Error('SECURE_STORAGE_REQUIRED')
}
export class DirectStore {
  constructor(private path: string) {}
  async read(): Promise<DirectSettings> {
    await available()
    try {
      const bytes = await readFile(this.path)
      const text = process.platform === 'darwin' ? (await safeStorage.decryptStringAsync(bytes)).result : safeStorage.decryptString(bytes)
      const value = Stored.parse(JSON.parse(text))
      const grants: DirectSettings['grants'] = []
      for (const grant of value.grants) {
        try { await lstat(this.path + '.revoked-' + grant.id) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          grants.push(grant)
        }
      }
      return { ...value, grants, iceServers: value.iceServers ?? [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return emptyDirectSettings()
    }
  }
  /** Revocation does not require unlocking or rewriting the encrypted credential store. */
  async revoke(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('INVALID_GRANT')
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try {
      const file = await open(this.path + '.revoked-' + id, 'wx', 0o600)
      try { await file.sync() } finally { await file.close() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  async write(value: DirectSettings) {
    await available(); Stored.parse(value)
    const text = JSON.stringify(value)
    const bytes = process.platform === 'darwin' ? await safeStorage.encryptStringAsync(text) : safeStorage.encryptString(text)
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.path)
  }
}
