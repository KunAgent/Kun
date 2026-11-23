import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SafeStorage } from 'electron'

export type StoredColabOAuthToken = {
  token: string
  refresh_token: string
  token_uri: string
  client_id: string
  client_secret: string
  scopes: string[]
  expiry?: string
}

const FALLBACK_AAD = Buffer.from('kun-colab-oauth-token.v1')

async function bounded<T>(operation: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Colab secure credential storage timed out.')), timeoutMs)
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function loadOrCreateFallbackKey(keyPath: string, create: boolean): Promise<Buffer> {
  const parse = (raw: string): Buffer => {
    const key = Buffer.from(raw.trim(), 'base64')
    if (key.length !== 32) throw new Error('Invalid Colab fallback encryption key.')
    return key
  }
  try {
    return parse(await readFile(keyPath, 'utf8'))
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32)
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 })
  try {
    const handle = await open(keyPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${key.toString('base64')}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return parse(await readFile(keyPath, 'utf8'))
  }
}

export class ColabCredentialStore {
  private readonly keyPath: string

  constructor(
    private readonly colabRootDir: string,
    private readonly safeStorage: SafeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.keyPath = join(colabRootDir, 'connections', 'fallback-master.key')
  }

  private encryptedTokenPath(connectionId: string): string {
    return join(this.colabRootDir, 'connections', connectionId, 'credentials.enc')
  }

  runtimeTokenPath(connectionId: string): string {
    return join(this.colabRootDir, 'runtime', connectionId, 'oauth_token.json')
  }

  private async osEncryptionAvailable(): Promise<boolean> {
    const hasAsync = typeof this.safeStorage.isAsyncEncryptionAvailable === 'function'
    const available =
      this.platform === 'darwin' && hasAsync
        ? await bounded(this.safeStorage.isAsyncEncryptionAvailable())
        : this.safeStorage.isEncryptionAvailable()
    return (
      available &&
      !(
        this.platform === 'linux' &&
        ['basic_text', 'unknown'].includes(this.safeStorage.getSelectedStorageBackend())
      )
    )
  }

  private async encrypt(plaintext: string): Promise<Record<string, unknown>> {
    if (await this.osEncryptionAvailable()) {
      const encrypted =
        this.platform === 'darwin' && typeof this.safeStorage.encryptStringAsync === 'function'
          ? await bounded(this.safeStorage.encryptStringAsync(plaintext))
          : this.safeStorage.encryptString(plaintext)
      return { version: 1, encrypted: encrypted.toString('base64') }
    }
    const nonce = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      await loadOrCreateFallbackKey(this.keyPath, true),
      nonce
    )
    cipher.setAAD(FALLBACK_AAD)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      version: 2,
      mode: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  }

  private async decrypt(record: Record<string, unknown>): Promise<string> {
    if (record.version === 1 && typeof record.encrypted === 'string') {
      if (!(await this.osEncryptionAvailable())) {
        throw new Error('OS credential encryption is currently unavailable.')
      }
      const bytes = Buffer.from(record.encrypted, 'base64')
      return this.platform === 'darwin' && typeof this.safeStorage.decryptStringAsync === 'function'
        ? (await bounded(this.safeStorage.decryptStringAsync(bytes))).result
        : this.safeStorage.decryptString(bytes)
    }
    if (
      record.version === 2 &&
      record.mode === 'aes-256-gcm' &&
      typeof record.nonce === 'string' &&
      typeof record.tag === 'string' &&
      typeof record.ciphertext === 'string'
    ) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await loadOrCreateFallbackKey(this.keyPath, false),
        Buffer.from(record.nonce, 'base64')
      )
      decipher.setAAD(FALLBACK_AAD)
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final()
      ]).toString('utf8')
    }
    throw new Error('Unrecognized Colab credential envelope.')
  }

  async writeToken(connectionId: string, token: StoredColabOAuthToken): Promise<void> {
    const target = this.encryptedTokenPath(connectionId)
    const temp = `${target}.${randomUUID()}.tmp`
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    try {
      const envelope = await this.encrypt(JSON.stringify(token))
      await writeFile(temp, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' })
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  async readToken(connectionId: string): Promise<StoredColabOAuthToken | null> {
    let rawEnvelope: string
    try {
      rawEnvelope = await readFile(this.encryptedTokenPath(connectionId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const parsed = JSON.parse(rawEnvelope) as Record<string, unknown>
    const plaintext = await this.decrypt(parsed)
    const token = JSON.parse(plaintext) as StoredColabOAuthToken
    if (!token || typeof token.refresh_token !== 'string' || !token.refresh_token) {
      throw new Error('Stored Colab credential is missing refresh_token.')
    }
    return token
  }

  /**
   * Materializes the decrypted OAuth JSON into a 0600 per-connection runtime file
   * for isolated `colab` subprocess execution via `PYTHON_KEYRING_BACKEND`.
   */
  async materializeRuntimeToken(connectionId: string): Promise<string> {
    const token = await this.readToken(connectionId)
    if (!token) {
      throw new Error('Colab connection credentials not found.')
    }
    const runtimeFile = this.runtimeTokenPath(connectionId)
    await mkdir(dirname(runtimeFile), { recursive: true, mode: 0o700 })
    const temp = `${runtimeFile}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(token), { mode: 0o600 })
      if (this.platform !== 'win32') await chmod(temp, 0o600).catch(() => undefined)
      await rename(temp, runtimeFile)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
    return runtimeFile
  }

  /**
   * Syncs any refreshed access_token written by `kun_colab_keyring` back into
   * the encrypted `safeStorage` envelope so subsequent invocations reuse it.
   */
  async syncRuntimeTokenBack(connectionId: string): Promise<void> {
    const runtimeFile = this.runtimeTokenPath(connectionId)
    try {
      const content = await readFile(runtimeFile, 'utf8')
      const updated = JSON.parse(content) as StoredColabOAuthToken
      if (updated && typeof updated.refresh_token === 'string' && updated.refresh_token) {
        await this.writeToken(connectionId, updated)
      }
    } catch {
      // Ignore if subprocess did not modify or touch the runtime token file.
    }
  }

  async removeConnection(connectionId: string): Promise<void> {
    await rm(join(this.colabRootDir, 'connections', connectionId), {
      recursive: true,
      force: true
    }).catch(() => undefined)
    await rm(join(this.colabRootDir, 'runtime', connectionId), {
      recursive: true,
      force: true
    }).catch(() => undefined)
  }

  async cleanupRuntimeFiles(): Promise<void> {
    await rm(join(this.colabRootDir, 'runtime'), { recursive: true, force: true }).catch(
      () => undefined
    )
  }
}
