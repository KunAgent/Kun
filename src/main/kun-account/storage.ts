import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SafeStorage } from 'electron'
import type { AccountTokens } from './transport'
import { AccountError } from './errors'

export interface AccountStorage {
  assertAvailable(): Promise<void>
  read(): Promise<AccountTokens | null>
  write(tokens: AccountTokens): Promise<void>
  clear(): Promise<void>
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AccountError('secure_storage')), 15_000)
  })]).finally(() => clearTimeout(timer))
}

export function createAccountStorage(path: string, safe: SafeStorage, platform = process.platform): AccountStorage {
  async function assertAvailable(): Promise<void> {
    const available = platform === 'darwin' ? await bounded(safe.isAsyncEncryptionAvailable()) : safe.isEncryptionAvailable()
    if (!available || (platform === 'linux' && ['basic_text', 'unknown'].includes(safe.getSelectedStorageBackend()))) throw new AccountError('secure_storage')
  }
  return {
    assertAvailable,
    async read() {
      let data: string
      try { data = await readFile(path, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new AccountError('secure_storage') }
      try {
        if (data.length > 100_000) throw new Error()
        const record = JSON.parse(data)
        if (record.version !== 1 || typeof record.encrypted !== 'string') throw new Error()
        await assertAvailable()
        const encrypted = Buffer.from(record.encrypted, 'base64')
        if (platform === 'darwin' && !['v10', 'v11'].includes(encrypted.subarray(0, 3).toString('ascii'))) throw new Error()
        const raw = platform === 'darwin' ? (await bounded(safe.decryptStringAsync(encrypted))).result : safe.decryptString(encrypted)
        const tokens = JSON.parse(raw)
        if (typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || !Number.isFinite(tokens.expiresAt)) throw new Error()
        return tokens
      } catch { throw new AccountError('secure_storage') }
    },
    async write(tokens) {
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await assertAvailable()
        const raw = JSON.stringify(tokens)
        const encrypted = platform === 'darwin' ? await bounded(safe.encryptStringAsync(raw)) : safe.encryptString(raw)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }), { mode: 0o600, flag: 'wx' })
        await rename(temporary, path)
      } catch { throw new AccountError('secure_storage') }
      finally { await rm(temporary, { force: true }).catch(() => {}) }
    },
    async clear() {
      try { await rm(path, { force: true }) } catch { throw new AccountError('secure_storage') }
    }
  }
}
