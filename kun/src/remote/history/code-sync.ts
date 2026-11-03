import { randomUUID } from 'node:crypto'
import { diffHistory, compactHistorySyncDelta, HISTORY_SYNC_MAX_PATCH_BYTES, HISTORY_SYNC_MAX_SNAPSHOT_BYTES,
  type HistorySyncFrame, type HistorySyncSubscription } from '@kun/remote-protocol'
import type { RuntimeEvent } from '../../contracts/events.js'
import { boundCodePage, projectCodeEvent, reconcileCodePage, type CodePage } from './code-events.js'

type Delivery = Omit<Extract<HistorySyncFrame, { kind: 'patch' }>, 'subscriptionId'>
type Listener = (frame: Omit<HistorySyncFrame, 'subscriptionId'>) => void
export interface CodeSyncDependencies {
  load(): Promise<CodePage>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  replay(floor: number, buffered: RuntimeEvent[]): Promise<{ events: RuntimeEvent[]; through: number }>
  version?(): Promise<string | undefined>
  now?(): number
}
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const MAX_LOG_BYTES = 2 * 1024 * 1024
const RETAIN_MS = 120000

/** One authorized view; its ephemeral epoch never survives a Runtime/projection restart. */
export class CodeHistorySync {
  private epoch = randomUUID()
  private seq = 0
  private page?: CodePage
  private published?: CodePage
  private log: { frame: Delivery; at: number; bytes: number }[] = []
  private logBytes = 0
  private events: RuntimeEvent[] = []
  private eventBytes = 0
  private sourceSeq = 0
  private itemVersions = new Map<string, number>()
  private listeners = new Set<Listener>()
  private off = () => {}
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private initializing = true
  private closed = false
  private failure?: string
  private now: () => number
  readonly initialized: Promise<void>
  constructor(private deps: CodeSyncDependencies, private changed: () => void = () => {}) {
    this.now = deps.now ?? Date.now
    this.off = deps.subscribe(event => this.receive(event))
    this.initialized = this.initialize().catch(error => { this.fail(error); throw error })
  }
  get bytes() { return this.logBytes + this.eventBytes + (this.page ? size(this.page) : 0) }
  get observers() { return this.listeners.size }
  get valid() { return !this.closed && !this.failure }
  get cursor() { return this.published && this.valid ? { epoch: this.epoch, seq: this.seq } : undefined }
  clearReplay() { this.log = []; this.logBytes = 0 }
  private receive(event: RuntimeEvent) {
    if (this.closed || event.seq <= this.sourceSeq) return
    this.events.push(event)
    this.eventBytes += size(event)
    if (this.events.length > 512 || this.eventBytes > MAX_LOG_BYTES) { this.fail(new Error('HISTORY_SOURCE_OVERFLOW')); return }
    if (this.initializing) return
    const text = event.kind === 'assistant_text_delta' || event.kind === 'assistant_reasoning_delta' ||
      event.kind === 'item_updated' && event.item.status === 'running'
    if (!text) { clearTimeout(this.timer); this.timer = undefined; void this.flush().catch(() => {}) }
    else this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}) }, 50)
  }
  private async initialize() {
    const page = boundCodePage(await this.deps.load())
    const floor = page.latestSeq
    if (!Number.isSafeInteger(floor) || floor < 0) throw new Error('UNSUPPORTED_HISTORY_SOURCE')
    const replay = await this.deps.replay(floor, this.events)
    if (this.failure || this.closed) throw new Error(this.failure ?? 'HISTORY_CLOSED')
    this.page = page
    this.sourceSeq = floor
    for (const event of replay.events) await this.apply(event)
    this.sourceSeq = Math.max(this.sourceSeq, replay.through)
    const version = await this.deps.version?.()
    if (version !== undefined && version !== this.page.historyVersion) throw new Error('HISTORY_SOURCE_GAP')
    this.initializing = false
    await this.flush()
    this.published = this.page
  }
  private async apply(event: RuntimeEvent) {
    if (!this.page || event.seq <= this.sourceSeq) return
    const projected = projectCodeEvent(this.page, event)
    if (projected) {
      this.page = projected
      if ('item' in event && projected !== this.published) this.itemVersions.set(event.item.id, event.seq)
    }
    else {
      const refreshed = boundCodePage(await this.deps.load())
      if (refreshed.historyVersion !== this.page.historyVersion) {
        this.epoch = randomUUID(); this.seq = 0; this.clearReplay(); this.published = undefined
        this.itemVersions.clear()
      }
      const reconciled = reconcileCodePage(this.page, refreshed, this.itemVersions)
      const updated = 'item' in event ? projectCodeEvent(reconciled, event) : null
      if (updated && 'item' in event) this.itemVersions.set(event.item.id, event.seq)
      this.page = { ...(updated ?? reconciled),
        latestSeq: Math.max(refreshed.latestSeq, event.seq) }
    }
    const visible = new Set(this.page.turns.flatMap(turn => turn.items.map(item => item.id)))
    for (const id of this.itemVersions.keys()) if (!visible.has(id)) this.itemVersions.delete(id)
    this.sourceSeq = event.seq
  }
  async flush(): Promise<void> {
    if (this.running) { await this.running; if (this.events.length) return this.flush(); return }
    if (this.closed) throw new Error(this.failure ?? 'HISTORY_CLOSED')
    const run = async () => {
      while (this.events.length) {
        const events = this.events; this.events = []; this.eventBytes = 0
        for (const event of events.sort((a, b) => a.seq - b.seq)) await this.apply(event)
      }
      if (!this.page) return
      if (size(this.page) > HISTORY_SYNC_MAX_SNAPSHOT_BYTES - 1024) throw new Error('HISTORY_SNAPSHOT_LIMIT')
      const diff = this.published && diffHistory('code', this.published, this.page)
      if (diff && 'unchanged' in diff) return
      if (diff && 'delta' in diff) {
        const frame: Delivery = { kind: 'patch', epoch: this.epoch, baseSeq: this.seq, seq: this.seq + 1,
          ...compactHistorySyncDelta(this.published!, diff.delta) }
        const bytes = size(frame)
        if (bytes <= HISTORY_SYNC_MAX_PATCH_BYTES - 256) {
          this.seq++; this.log.push({ frame, at: this.now(), bytes }); this.logBytes += bytes
          this.prune(); this.publish(frame)
          this.published = this.page; this.changed(); return
        }
        this.epoch = randomUUID(); this.seq = 0; this.clearReplay()
      }
      this.published = this.page
      this.publish({ kind: 'snapshot', epoch: this.epoch, seq: this.seq, data: this.page } as Omit<HistorySyncFrame, 'subscriptionId'>)
      this.publish({ kind: 'ready', epoch: this.epoch, seq: this.seq } as Omit<HistorySyncFrame, 'subscriptionId'>)
      this.changed()
    }
    this.running = run().catch(error => { this.fail(error); throw error })
    try { await this.running } finally { this.running = undefined }
  }
  private prune() {
    while (this.log.length && (this.log.length > 1024 || this.logBytes > MAX_LOG_BYTES || this.log[0]!.at < this.now() - RETAIN_MS))
      this.logBytes -= this.log.shift()!.bytes
  }
  async attach(input: HistorySyncSubscription, send: (frame: HistorySyncFrame) => void): Promise<() => void> {
    await this.initialized
    await this.flush()
    if (!this.valid || !this.page) throw new Error('HISTORY_SYNC_UNAVAILABLE')
    this.prune()
    const listener: Listener = frame => send({ ...frame, subscriptionId: input.subscriptionId } as HistorySyncFrame)
    const after = input.after
    const canResume = after?.epoch === this.epoch && after.seq <= this.seq &&
      after.seq >= (this.log[0]?.frame.baseSeq ?? this.seq)
    if (canResume) {
      for (const entry of this.log) if (entry.frame.seq > after!.seq) listener(entry.frame)
    } else listener({ kind: 'snapshot', epoch: this.epoch, seq: this.seq, data: this.page } as Omit<HistorySyncFrame, 'subscriptionId'>)
    listener({ kind: 'ready', epoch: this.epoch, seq: this.seq } as Omit<HistorySyncFrame, 'subscriptionId'>)
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(frame: Omit<HistorySyncFrame, 'subscriptionId'>) {
    for (const listener of [...this.listeners]) {
      try { listener(frame) } catch { this.listeners.delete(listener) }
    }
  }
  private fail(error: unknown) {
    this.failure = error instanceof Error && /^[A-Z_]{1,96}$/.test(error.message) ? error.message : 'HISTORY_SYNC_UNAVAILABLE'
    this.publish({ kind: 'reset', reason: this.failure } as Omit<HistorySyncFrame, 'subscriptionId'>)
    this.close()
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (!this.failure) this.publish({ kind: 'reset', reason: 'HISTORY_CLOSED' } as Omit<HistorySyncFrame, 'subscriptionId'>)
    this.off(); clearTimeout(this.timer)
    this.events = []; this.eventBytes = 0; this.clearReplay(); this.listeners.clear()
  }
}
