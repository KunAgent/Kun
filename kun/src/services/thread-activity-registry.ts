import { randomUUID } from 'node:crypto'
import type { RuntimeEvent } from '../contracts/events.js'
import type {
  ThreadActivityBatch,
  ThreadActivityChange,
  ThreadActivityKind
} from '../contracts/thread-activity.js'
import type { RuntimeEventObserver } from './runtime-event-recorder.js'

const DEFAULT_CAPACITY = 2_048
const KIND_PRIORITY: Record<ThreadActivityKind, number> = {
  runtime: 0,
  metadata: 1,
  created: 2,
  deleted: 3
}

const RUNTIME_KINDS = new Set<RuntimeEvent['kind']>([
  'turn_started', 'turn_completed', 'turn_failed', 'turn_aborted',
  'user_input_requested', 'user_input_resolved'
])

type StoredChange = ThreadActivityChange & { revision: number }

export class ThreadActivityRegistry implements RuntimeEventObserver {
  readonly epoch: string
  private revision = 0
  private readonly changes: StoredChange[] = []
  private readonly listeners = new Set<() => void>()

  constructor(private readonly capacity = DEFAULT_CAPACITY, epoch: string = randomUUID()) {
    this.epoch = epoch
  }

  record(event: RuntimeEvent): void {
    const kind = activityKind(event.kind)
    if (!kind) return
    this.append({ threadId: event.threadId, kind, threadSeq: event.seq })
  }

  clearThread(threadId: string): void {
    this.append({ threadId, kind: 'deleted' })
  }

  cursor(): string {
    return encodeCursor(this.epoch, this.revision)
  }

  changesSince(cursor?: string):
    | { resetRequired: false; batch: ThreadActivityBatch }
    | { resetRequired: true; cursor: string; reason: string } {
    const parsed = cursor ? decodeCursor(cursor) : { epoch: this.epoch, revision: 0 }
    if (!parsed || parsed.epoch !== this.epoch) {
      return { resetRequired: true, cursor: this.cursor(), reason: 'runtime_epoch_changed' }
    }
    const floor = this.changes[0]?.revision ?? this.revision + 1
    if (parsed.revision < floor - 1) {
      return { resetRequired: true, cursor: this.cursor(), reason: 'cursor_expired' }
    }
    const byThread = new Map<string, StoredChange>()
    for (const change of this.changes) {
      if (change.revision <= parsed.revision) continue
      const previous = byThread.get(change.threadId)
      if (!previous || KIND_PRIORITY[change.kind] >= KIND_PRIORITY[previous.kind]) {
        byThread.set(change.threadId, change)
      }
    }
    return {
      resetRequired: false,
      batch: {
        cursor: this.cursor(),
        changes: [...byThread.values()].map(({ revision: _revision, ...change }) => change)
      }
    }
  }

  waitForChange(signal: AbortSignal, timeoutMs: number): Promise<void> {
    if (signal.aborted || timeoutMs <= 0) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const unsubscribe = this.subscribe(finish)
      timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      signal.addEventListener('abort', finish, { once: true })
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private append(change: ThreadActivityChange): void {
    this.revision += 1
    this.changes.push({ ...change, revision: this.revision })
    while (this.changes.length > this.capacity) this.changes.shift()
    for (const listener of this.listeners) listener()
  }
}

function activityKind(kind: RuntimeEvent['kind']): ThreadActivityKind | null {
  if (kind === 'thread_created') return 'created'
  if (
    kind === 'thread_updated' ||
    kind === 'thread_pruned' ||
    kind === 'thread_restored' ||
    kind === 'todos_updated' ||
    kind === 'todos_cleared'
  ) {
    return 'metadata'
  }
  return RUNTIME_KINDS.has(kind) ? 'runtime' : null
}

function encodeCursor(epoch: string, revision: number): string {
  return Buffer.from(JSON.stringify({ epoch, revision }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { epoch: string; revision: number } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof value.epoch === 'string' && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
      ? { epoch: value.epoch, revision: Number(value.revision) }
      : null
  } catch {
    return null
  }
}
