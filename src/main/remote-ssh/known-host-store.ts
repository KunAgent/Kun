import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RemoteSshHostKeyConfirmation } from '../../shared/remote-ssh'

type KnownHostDocument = { version: 1; keys: Record<string, { fingerprint: string; key: string }> }

export function sshHostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export type RemoteSshHostKeyState = 'unknown' | 'match' | 'mismatch'

export class RemoteSshKnownHostStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async state(hostId: string, key: Buffer): Promise<RemoteSshHostKeyState> {
    return this.serial(async () => {
      const saved = (await this.load()).keys[hostId]
      if (!saved) return 'unknown'
      const actual = Buffer.from(key.toString('base64'))
      const expected = Buffer.from(saved.key)
      return actual.length === expected.length && timingSafeEqual(actual, expected)
        ? 'match'
        : 'mismatch'
    })
  }

  async matches(hostId: string, key: Buffer): Promise<boolean> {
    return (await this.state(hostId, key)) === 'match'
  }

  confirm(confirmation: RemoteSshHostKeyConfirmation): Promise<void> {
    return this.serial(async () => {
      const key = Buffer.from(confirmation.key, 'base64')
      if (sshHostKeyFingerprint(key) !== confirmation.fingerprint) {
        throw new Error('SSH host key fingerprint does not match the supplied key.')
      }
      const document = await this.load()
      const existing = document.keys[confirmation.hostId]
      if (existing && existing.key !== key.toString('base64')) {
        throw new Error('A different SSH host key is already trusted for this host.')
      }
      document.keys[confirmation.hostId] = {
        fingerprint: confirmation.fingerprint,
        key: key.toString('base64')
      }
      await this.save(document)
    })
  }

  reset(hostId: string): Promise<boolean> {
    return this.serial(async () => {
      const document = await this.load()
      if (!document.keys[hostId]) return false
      delete document.keys[hostId]
      await this.save(document)
      return true
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async load(): Promise<KnownHostDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as KnownHostDocument
      if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== 'object') {
        throw new Error('Unsupported SSH known-host store.')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, keys: {} }
      throw error
    }
  }

  private async save(document: KnownHostDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.filePath)
  }
}
