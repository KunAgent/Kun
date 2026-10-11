import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import type { SafeStorage } from 'electron'
import type { AccountTokens } from './transport'
import { AccountError } from './errors'

export interface AccountStorage {
  assertAvailable(): Promise<void>
  read(): Promise<AccountTokens | null>
  write(tokens: AccountTokens): Promise<void>
  clear(): Promise<void>
}

const FALLBACK_AAD = Buffer.from('kun-account-session.v2')

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AccountError('secure_storage')), 15_000)
  })]).finally(() => clearTimeout(timer))
}

/** Profile-local 0600 AES key, shared semantics with Kun's extension credential fallback. */
async function loadOrCreateKey(path: string, create: boolean): Promise<Buffer> {
  const parse = (text: string) => {
    const key = Buffer.from(text.trim(), 'base64')
    if (key.length !== 32) throw new Error('invalid account key')
    return key
  }
  try { return parse(await readFile(path, 'utf8')) }
  catch (error) { if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const key = randomBytes(32)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(`${key.toString('base64')}\n`, 'utf8') } finally { await handle.close() }
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return parse(await readFile(path, 'utf8'))
  }
}

/**
 * Tokens are protected by the OS credential store (Keychain/DPAPI/libsecret)
 * when available. Machines without one (e.g. Linux with no keyring, where
 * Electron reports basic_text) use an authenticated AES-256-GCM envelope with a
 * profile-local 0600 key instead of blocking sign-in. Never plaintext.
 */
export function createAccountStorage(path: string, safe: SafeStorage, platform = process.platform): AccountStorage {
  const keyPath = join(dirname(path), 'session.key')
  async function osAvailable(): Promise<boolean> {
    const available = platform === 'darwin' ? await bounded(safe.isAsyncEncryptionAvailable()) : safe.isEncryptionAvailable()
    return available && !(platform === 'linux' && ['basic_text', 'unknown'].includes(safe.getSelectedStorageBackend()))
  }
  async function assertAvailable(): Promise<void> {
    if (await osAvailable()) return
    try { await loadOrCreateKey(keyPath, true) } catch { throw new AccountError('secure_storage') }
  }
  async function decryptFallback(record: Record<string, unknown>): Promise<string> {
    if (typeof record.nonce !== 'string' || typeof record.tag !== 'string' || typeof record.ciphertext !== 'string') throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', await loadOrCreateKey(keyPath, false), Buffer.from(record.nonce, 'base64'))
    decipher.setAAD(FALLBACK_AAD)
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }
  async function decryptOs(record: Record<string, unknown>): Promise<string> {
    if (typeof record.encrypted !== 'string') throw new Error()
    if (!await osAvailable()) throw new Error()
    const encrypted = Buffer.from(record.encrypted, 'base64')
    if (platform === 'darwin' && !['v10', 'v11'].includes(encrypted.subarray(0, 3).toString('ascii'))) throw new Error()
    return platform === 'darwin' ? (await bounded(safe.decryptStringAsync(encrypted))).result : safe.decryptString(encrypted)
  }
  async function encrypt(raw: string): Promise<Record<string, unknown>> {
    if (await osAvailable()) {
      const encrypted = platform === 'darwin' ? await bounded(safe.encryptStringAsync(raw)) : safe.encryptString(raw)
      return { version: 1, encrypted: encrypted.toString('base64') }
    }
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await loadOrCreateKey(keyPath, true), nonce)
    cipher.setAAD(FALLBACK_AAD)
    const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
    return { version: 2, mode: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
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
        if (!record || typeof record !== 'object') throw new Error()
        const raw = record.version === 1 ? await decryptOs(record)
          : record.version === 2 && record.mode === 'aes-256-gcm' ? await decryptFallback(record)
          : (() => { throw new Error() })()
        const tokens = JSON.parse(raw)
        if (typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || !Number.isFinite(tokens.expiresAt)) throw new Error()
        return tokens
      } catch { throw new AccountError('secure_storage') }
    },
    async write(tokens) {
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        const record = await encrypt(JSON.stringify(tokens))
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
        await rename(temporary, path)
      } catch { throw new AccountError('secure_storage') }
      finally { await rm(temporary, { force: true }).catch(() => {}) }
    },
    async clear() {
      try { await rm(path, { force: true }) } catch { throw new AccountError('secure_storage') }
    }
  }
}
