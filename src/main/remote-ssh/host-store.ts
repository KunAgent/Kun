import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RemoteSshHost, RemoteSshHostInput } from '../../shared/remote-ssh'
import { REMOTE_SSH_DEFAULT_PORT, REMOTE_SSH_MAX_HOSTS } from '../../shared/remote-ssh'

export type RemoteSshHostStore = {
  list: () => Promise<RemoteSshHost[]>
  create: (input: RemoteSshHostInput) => Promise<RemoteSshHost>
  update: (id: string, input: RemoteSshHostInput) => Promise<RemoteSshHost>
  remove: (id: string) => Promise<boolean>
  get: (id: string) => Promise<RemoteSshHost | undefined>
}

type StoreDocument = { version: 1; hosts: RemoteSshHost[] }

export class JsonRemoteSshHostStore implements RemoteSshHostStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  list(): Promise<RemoteSshHost[]> {
    return this.serial(async () => structuredClone((await this.load()).hosts))
  }

  get(id: string): Promise<RemoteSshHost | undefined> {
    return this.serial(async () => structuredClone((await this.load()).hosts.find((host) => host.id === id)))
  }

  create(input: RemoteSshHostInput): Promise<RemoteSshHost> {
    return this.serial(async () => {
      const document = await this.load()
      if (document.hosts.length >= REMOTE_SSH_MAX_HOSTS) throw new Error('SSH host limit reached.')
      const now = new Date().toISOString()
      const host: RemoteSshHost = {
        ...input,
        port: input.port ?? REMOTE_SSH_DEFAULT_PORT,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      }
      document.hosts.push(host)
      await this.save(document)
      return structuredClone(host)
    })
  }

  update(id: string, input: RemoteSshHostInput): Promise<RemoteSshHost> {
    return this.serial(async () => {
      const document = await this.load()
      const index = document.hosts.findIndex((host) => host.id === id)
      if (index < 0) throw new Error('SSH host not found.')
      const previous = document.hosts[index]
      const host: RemoteSshHost = {
        ...input,
        port: input.port ?? REMOTE_SSH_DEFAULT_PORT,
        id,
        createdAt: previous.createdAt,
        updatedAt: new Date().toISOString()
      }
      document.hosts[index] = host
      await this.save(document)
      return structuredClone(host)
    })
  }

  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const document = await this.load()
      const next = document.hosts.filter((host) => host.id !== id)
      if (next.length === document.hosts.length) return false
      document.hosts = next
      await this.save(document)
      return true
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async load(): Promise<StoreDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as StoreDocument
      if (parsed.version !== 1 || !Array.isArray(parsed.hosts)) throw new Error('Unsupported SSH host store.')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: [] }
      throw error
    }
  }

  private async save(document: StoreDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.filePath)
  }
}
