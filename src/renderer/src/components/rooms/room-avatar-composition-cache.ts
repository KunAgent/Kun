export interface AvatarCompositionResource {
  url: string
  bytes: number
  dispose: () => void
}

export interface AvatarCompositionLease {
  promise: Promise<string>
  release: () => void
}

interface Entry {
  promise: Promise<string>
  resource?: AvatarCompositionResource
  users: number
  retired: boolean
}

/** Active images stay leased; only idle resources count toward the bounded LRU. */
export class AvatarCompositionCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly maxEntries = 80, private readonly maxBytes = 16 * 1024 * 1024) {}

  acquire(key: string, create: (isNeeded: () => boolean) => Promise<AvatarCompositionResource>): AvatarCompositionLease {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { promise: Promise.resolve(''), users: 0, retired: false }
      const created = entry
      entry.promise = Promise.resolve().then(() => create(() => created.users > 0)).then((resource) => {
        created.resource = resource
        if (created.retired && created.users === 0) this.dispose(created)
        this.trim()
        return resource.url
      }, (error: unknown) => {
        if (this.entries.get(key) === created) this.entries.delete(key)
        throw error
      })
      this.entries.set(key, entry)
    } else {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    entry.users += 1
    const leased = entry
    let released = false
    return {
      promise: leased.promise,
      release: () => {
        if (released) return
        released = true
        leased.users -= 1
        if (leased.retired && leased.users === 0) this.dispose(leased)
        this.trim()
      }
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.retired = true
      if (entry.users === 0) this.dispose(entry)
    }
    this.entries.clear()
  }

  private dispose(entry: Entry): void {
    entry.resource?.dispose()
    entry.resource = undefined
  }

  private trim(): void {
    const idle = [...this.entries].filter(([, entry]) => entry.users === 0 && entry.resource)
    let count = idle.length
    let bytes = idle.reduce((sum, [, entry]) => sum + entry.resource!.bytes, 0)
    for (const [key, entry] of idle) {
      if (count <= this.maxEntries && bytes <= this.maxBytes) break
      count -= 1
      bytes -= entry.resource!.bytes
      this.entries.delete(key)
      entry.retired = true
      this.dispose(entry)
    }
  }
}
