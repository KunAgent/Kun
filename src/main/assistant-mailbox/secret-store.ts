// Enrollment secrets for the assistant mailbox. Each secret is the only key to that assistant's
// end-to-end encrypted messages, so it never leaves Main and is stored encrypted by the OS
// keychain (Electron safeStorage), one file per Kun account.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export type SecretCipher = {
  encrypt(text: string): Promise<Buffer>
  decrypt(data: Buffer): Promise<string>
}

type Entry = { secret: string; createdAt: string }
type SecretFile = { version: 1; entries: Record<string, Entry> }

/** Same availability rules as the remote-access device identity. */
export async function electronSecretCipher(): Promise<SecretCipher> {
  const { safeStorage } = await import('electron')
  const available = process.platform === 'darwin'
    ? await safeStorage.isAsyncEncryptionAvailable()
    : safeStorage.isEncryptionAvailable()
  if (!available || (process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))) {
    throw new Error('SECURE_STORAGE_REQUIRED')
  }
  return process.platform === 'darwin'
    ? {
        encrypt: (text) => safeStorage.encryptStringAsync(text),
        decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result
      }
    : {
        encrypt: async (text) => safeStorage.encryptString(text),
        decrypt: async (data) => safeStorage.decryptString(data)
      }
}

export class AssistantSecretStore {
  private cache: Map<string, Entry> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string, private readonly cipher: () => Promise<SecretCipher>) {}

  private async load(): Promise<Map<string, Entry>> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await (await this.cipher()).decrypt(await readFile(this.path))) as SecretFile
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries) ||
          !Object.values(parsed.entries).every(entry => typeof entry.secret === 'string' && Number.isFinite(Date.parse(entry.createdAt)))) throw new Error('ASSISTANT_SECRET_STORE_UNSUPPORTED')
      this.cache = new Map(Object.entries(parsed.entries))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = new Map()
    }
    return this.cache
  }

  private async persist(entries: Map<string, Entry>): Promise<void> {
    const file: SecretFile = { version: 1, entries: Object.fromEntries(entries) }
    const encrypted = await (await this.cipher()).encrypt(JSON.stringify(file))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(encrypted); await handle.sync() } finally { await handle.close() }
    await rename(temporary, this.path)
    if (process.platform !== 'win32') { const directory = await open(dirname(this.path), 'r'); try { await directory.sync() } finally { await directory.close() } }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  async get(enrollmentId: string): Promise<string | undefined> {
    return (await this.load()).get(enrollmentId)?.secret
  }

  /** Durable before it resolves: callers show the enrollment code only afterwards. */
  set(enrollmentId: string, secret: string, now = new Date()): Promise<void> {
    return this.serial(async () => {
      const entries = new Map(await this.load())
      entries.set(enrollmentId, { secret, createdAt: now.toISOString() })
      await this.persist(entries)
      this.cache = entries
    })
  }

  /**
   * Forgets keys of revoked assistants and expired codes. Keys created in the last ten minutes
   * are kept even if the server does not list them yet.
   */
  retain(keep: ReadonlySet<string>, now = new Date()): Promise<void> {
    return this.serial(async () => {
      const entries = await this.load()
      const recent = now.getTime() - 10 * 60_000
      const next = new Map([...entries].filter(([id, entry]) => keep.has(id) || Date.parse(entry.createdAt) > recent))
      if (next.size === entries.size) return
      await this.persist(next)
      this.cache = next
    })
  }
}
