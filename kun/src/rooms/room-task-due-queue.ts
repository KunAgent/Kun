import type { RoomStore, RoomStoredDocument } from './room-store.js'
import type { RoomTaskExecution } from './room-runtime-types.js'

type Row = RoomStoredDocument<RoomTaskExecution>
const UNFINISHED = ['queued', 'waiting_dependency', 'running', 'needs_input', 'needs_approval', 'stopping', 'recovery_required']
const WAITING = new Set(['waiting_dependency', 'needs_input', 'needs_approval', 'recovery_required'])
const PAGE = 128
const WAIT_MS = 15_000

/** Rebuildable projection: bounded bootstrap, event invalidation and wait backoff. */
export class RoomTaskDueQueue {
  private readonly rows = new Map<string, Row>()
  private readonly next = new Map<string, number>()
  private readonly dirty = new Set<string>()
  private readonly dependencies = new Map<string, Set<string>>()
  private readonly threads = new Map<string, Set<string>>()
  private cursor = 0
  private scanCursor?: number
  private scanSeen = new Set<string>()
  private initialized = false
  private scanning = true
  private nextScan = 0
  private eventsReady = false
  private eventBacklog = false

  constructor(private readonly store: RoomStore) {}
  invalidate(id: string) { this.dirty.add(id); this.next.delete(id) }
  invalidateThread(threadId: string) {
    for (const id of this.threads.get(threadId) ?? []) this.invalidate(id)
  }
  async refresh(now: number) {
    if (!this.eventsReady) {
      this.cursor = await this.store.latestEventSeq?.() ?? 0
      this.eventsReady = true
    }
    const events = await this.store.events('*', this.cursor, PAGE)
    for (const event of events) {
      this.cursor = event.seq
      const payload = event.payload as { id?: string; taskId?: string }
      if (event.kind === 'task.updated' || event.kind === 'task.created') {
        const id = payload.taskId ?? payload.id
        if (id) this.invalidate(id)
        // A completed dependency can unblock any dependent waiting task.
        if (id) for (const dependent of this.dependencies.get(id) ?? []) this.invalidate(dependent)
      }
    }
    this.eventBacklog = events.length === PAGE
    if (!this.scanning && now >= this.nextScan) { this.scanning = true; this.scanCursor = undefined; this.scanSeen.clear() }
    if (this.scanning) {
      const page = await this.store.list<RoomTaskExecution>('task', {
        status: UNFINISHED, limit: PAGE, order: 'asc', afterSeq: this.scanCursor })
      for (const row of page) { this.scanSeen.add(row.id); this.remember(row) }
      this.scanCursor = page.at(-1)?.seq
      if (page.length < PAGE) {
        for (const id of this.rows.keys()) if (!this.scanSeen.has(id)) this.forget(id)
        this.scanning = false; this.initialized = true; this.nextScan = now + 60_000
      }
    }
    for (const id of [...this.dirty].slice(0, PAGE)) {
      this.dirty.delete(id)
      const row = await this.store.get<RoomTaskExecution>('task', id)
      if (row) this.remember(row)
      else this.forget(id)
    }
  }
  private remember(row: Row) {
    if (!UNFINISHED.includes(row.value.task.status)) { this.forget(row.id); return }
    const prior = this.rows.get(row.id)
    if (prior?.revision === row.revision) return
    if (prior) this.unindex(prior)
    if (this.rows.get(row.id)?.revision !== row.revision) this.next.delete(row.id)
    this.rows.set(row.id, row)
    for (const dependency of row.value.dependencyTaskIds) this.index(this.dependencies, dependency, row.id)
    for (const id of [row.value.task.executionThreadId, row.value.reviewThreadId]) if (id) this.index(this.threads, id, row.id)
  }
  private index(index: Map<string, Set<string>>, key: string, id: string) {
    if (!index.has(key)) index.set(key, new Set())
    index.get(key)!.add(id)
  }
  private unindex(row: Row) {
    for (const key of row.value.dependencyTaskIds) this.removeIndex(this.dependencies, key, row.id)
    for (const key of [row.value.task.executionThreadId, row.value.reviewThreadId]) if (key) this.removeIndex(this.threads, key, row.id)
  }
  private removeIndex(index: Map<string, Set<string>>, key: string, id: string) {
    const set = index.get(key)
    set?.delete(id)
    if (!set?.size) index.delete(key)
  }
  private forget(id: string) {
    const old = this.rows.get(id)
    if (old) this.unindex(old)
    this.rows.delete(id); this.next.delete(id)
  }
  get ready() { return this.initialized && !this.eventBacklog && !this.dirty.size }
  get backlogged() { return this.scanning || this.eventBacklog || this.dirty.size > 0 }
  all() { return [...this.rows.values()] }
  due(now: number) {
    return this.all().filter((row) => (this.next.get(row.id) ?? 0) <= now)
      .sort((a, b) => Number(b.value.task.status === 'stopping') - Number(a.value.task.status === 'stopping') ||
        (this.next.get(a.id) ?? 0) - (this.next.get(b.id) ?? 0) || a.seq - b.seq)
      .slice(0, PAGE)
  }
  observed(row: Row, now: number) {
    this.remember(row)
    if (!this.rows.has(row.id)) return
    this.next.set(row.id, now + (WAITING.has(row.value.task.status) ? WAIT_MS : 1_000))
  }
  get nextWakeAt() {
    let earliest: number | undefined
    for (const id of this.rows.keys()) earliest = Math.min(earliest ?? Infinity, this.next.get(id) ?? 0)
    return earliest
  }
}
