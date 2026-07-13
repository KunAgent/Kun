import {
  ManagedChildProcessSchema,
  type ManagedChildCleanupPolicy,
  type ManagedChildProcess
} from '../../shared/managed-child-process'

export type ManagedChildProcessUpdate = Partial<
  Pick<ManagedChildProcess, 'pid' | 'detached' | 'cleanupPolicy'>
>

export class ManagedChildProcessRegistryError extends Error {
  constructor(readonly code: 'DUPLICATE' | 'NOT_FOUND', message: string) {
    super(message)
    this.name = 'ManagedChildProcessRegistryError'
  }
}

/** Main-owned registry for live OS children; it never starts or terminates a process. */
export class ManagedChildProcessRegistry {
  private readonly records = new Map<string, ManagedChildProcess>()

  register(input: ManagedChildProcess): ManagedChildProcess {
    if (this.records.has(input.id)) {
      throw new ManagedChildProcessRegistryError(
        'DUPLICATE',
        `Managed child process is already registered: ${input.id}`
      )
    }
    const record = ManagedChildProcessSchema.parse(input)
    this.records.set(record.id, record)
    return this.snapshot(record)
  }

  get(id: string): ManagedChildProcess | undefined {
    const record = this.records.get(id)
    return record ? this.snapshot(record) : undefined
  }

  list(filter?: { ownerKind?: string; ownerId?: string }): ManagedChildProcess[] {
    return [...this.records.values()]
      .filter((record) => filter?.ownerKind === undefined || record.ownerKind === filter.ownerKind)
      .filter((record) => filter?.ownerId === undefined || record.ownerId === filter.ownerId)
      .map((record) => this.snapshot(record))
  }

  update(id: string, patch: ManagedChildProcessUpdate): ManagedChildProcess {
    const current = this.records.get(id)
    if (!current) {
      throw new ManagedChildProcessRegistryError('NOT_FOUND', `Managed child process was not found: ${id}`)
    }
    const next = ManagedChildProcessSchema.parse({ ...current, ...patch })
    this.records.set(id, next)
    return this.snapshot(next)
  }

  /** Removing an already-removed child is intentionally idempotent for shutdown paths. */
  remove(id: string): boolean {
    return this.records.delete(id)
  }

  /** Returns the records that require caller-owned cleanup and empties the registry. */
  drain(): ManagedChildProcess[] {
    const records = this.list()
    this.records.clear()
    return records
  }

  clear(): void {
    this.records.clear()
  }

  size(): number {
    return this.records.size
  }

  private snapshot(record: ManagedChildProcess): ManagedChildProcess {
    return Object.freeze({ ...record })
  }
}

export type { ManagedChildCleanupPolicy }
