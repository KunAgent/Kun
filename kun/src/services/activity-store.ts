import { randomUUID } from 'node:crypto'
import type { RuntimeEvent } from '../contracts/events.js'
import type {
  ActivityBatch,
  ActivityChange,
  ActivityChildren,
  ActivityPatch,
  ActivityProvenance,
  ActivityRow,
  ActivityState,
  ExecutionUnitKind,
  RegisterUnit
} from '../contracts/activity.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RuntimeEventObserver } from './runtime-event-recorder.js'
import { projectRuntimeEvent } from './activity-event-projection.js'
import { rollupState } from './activity-rollup.js'

const DEFAULT_MAX_ROWS = 2_000
const DEFAULT_CHANGES_CAPACITY = 4_096
const DEFAULT_PREVIEW_THROTTLE_MS = 2_000
const ARCHIVED_CLOSED_EVICT_MS = 7 * 24 * 60 * 60_000

/**
 * Only these producers may drive `mainState` for a unit kind. Everyone
 * else may still write supplementary fields — and the question-wait
 * exception workers use to surface a `question` wait to the manager and to
 * leave it once the answer arrives (docs/ade/06 §4.1, 09 §6.4).
 */
const AUTHORITY: Record<ExecutionUnitKind, readonly ActivityProvenance[]> = {
  thread: ['runtime'],
  worker: ['runtime'],
  'side-chat': ['runtime'],
  'graph-attempt': ['runtime'],
  'terminal-agent': ['hook', 'runtime']
}

export type ActivityStoreOptions = {
  nowIso: () => string
  nowMs?: () => number
  /** Optional thread metadata lookup used to fill auto-registered rows. */
  threadMetadata?: (threadId: string) => Promise<ThreadRecord | null>
  /** User-fact persistence; cleared when a row's thread is deleted. */
  facts?: { removeFact(unitId: string): void }
  maxRows?: number
  changesCapacity?: number
  previewThrottleMs?: number
}

type StoredChange = { unitId: string; revision: number; removed?: boolean }

export class ActivityStore implements RuntimeEventObserver {
  readonly epoch = randomUUID()
  private revision = 0
  private readonly rows = new Map<string, ActivityRow>()
  private readonly changes: StoredChange[] = []
  private readonly listeners = new Set<() => void>()
  private readonly lastEventAt = new Map<string, number>()
  private readonly lastPreviewAt = new Map<string, number>()
  private readonly pendingPreview = new Map<string, string>()
  private readonly previewTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly options: ActivityStoreOptions) {}

  register(input: RegisterUnit): ActivityRow {
    const existing = this.rows.get(input.unitId)
    if (existing) return existing
    const now = this.options.nowIso()
    const mainState = input.mainState ?? 'initializing'
    const row: ActivityRow = {
      unitId: input.unitId,
      kind: input.kind,
      threadId: input.threadId,
      ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      harnessId: input.harnessId,
      title: input.title,
      workspace: input.workspace,
      mainState,
      ...(input.lastOutcome ? { lastOutcome: input.lastOutcome } : {}),
      ...(input.waitingReason ? { waitingReason: input.waitingReason } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      children: { working: 0, waiting: 0, done: 0, failed: 0 },
      stateSince: now,
      updatedAt: now,
      provenance: input.provenance ?? 'runtime',
      restoredUnconfirmed: input.restoredUnconfirmed ?? false,
      stalled: false,
      state: 'initializing',
      visibility: input.visibility ?? 'active',
      residency: input.residency ?? 'live',
      ...(input.acknowledgedAt ? { acknowledgedAt: input.acknowledgedAt } : {}),
      ...(input.dismissedAt ? { dismissedAt: input.dismissedAt } : {}),
      pinned: input.pinned ?? false
    }
    row.state = rollupState(row.mainState, row.children, row.waitingReason)
    this.rows.set(row.unitId, row)
    this.bump(row.unitId)
    if (row.parentThreadId) this.recomputeParent(row.parentThreadId)
    this.evict()
    return row
  }

  /**
   * Single write entry point: authority check, merge, rollup, change record.
   * Unregistered units reject writes — creators must `register` first.
   */
  apply(unitId: string, patch: ActivityPatch, provenance: ActivityProvenance): void {
    const row = this.rows.get(unitId)
    if (!row) return
    if (
      patch.mainState !== undefined &&
      !AUTHORITY[row.kind].includes(provenance) &&
      !(patch.mainState === 'waiting' && patch.waitingReason === 'question') &&
      !(patch.mainState === 'working' && row.waitingReason === 'question')
    ) {
      return
    }
    const now = this.options.nowIso()
    const next = mergeRow(row, patch, provenance, now)
    next.state = rollupState(next.mainState, next.children, next.waitingReason)
    if (next.state !== row.state) next.stateSince = now
    if (rowsEqual(row, next)) return
    this.rows.set(unitId, next)
    this.bump(unitId)
    if (next.parentThreadId !== row.parentThreadId) {
      if (row.parentThreadId) this.recomputeParent(row.parentThreadId)
    }
    if (next.parentThreadId) this.recomputeParent(next.parentThreadId)
  }

  remove(unitId: string): void {
    const row = this.rows.get(unitId)
    if (!row) return
    this.rows.delete(unitId)
    this.lastEventAt.delete(unitId)
    this.pendingPreview.delete(unitId)
    this.lastPreviewAt.delete(unitId)
    const timer = this.previewTimers.get(unitId)
    if (timer) {
      clearTimeout(timer)
      this.previewTimers.delete(unitId)
    }
    this.bump(unitId, true)
    this.options.facts?.removeFact(unitId)
    if (row.parentThreadId) this.recomputeParent(row.parentThreadId)
  }

  /** Thread deletion removes the thread row and every unit it parents. */
  clearThread(threadId: string): void {
    const ids = [threadId]
    for (const row of this.rows.values()) {
      if (row.parentThreadId === threadId) ids.push(row.unitId)
    }
    for (const id of ids) this.remove(id)
  }

  get(unitId: string): ActivityRow | undefined {
    return this.rows.get(unitId)
  }

  list(): ActivityRow[] {
    return [...this.rows.values()]
  }

  cursor(): string {
    return encodeCursor(this.epoch, this.revision)
  }

  changesSince(
    cursor?: string
  ):
    | { resetRequired: false; batch: ActivityBatch }
    | { resetRequired: true; cursor: string; reason: string } {
    const parsed = cursor ? decodeCursor(cursor) : { epoch: this.epoch, revision: 0 }
    if (!parsed || parsed.epoch !== this.epoch) {
      return { resetRequired: true, cursor: this.cursor(), reason: 'runtime_epoch_changed' }
    }
    const floor = this.changes[0]?.revision ?? this.revision + 1
    if (parsed.revision < floor - 1) {
      return { resetRequired: true, cursor: this.cursor(), reason: 'cursor_expired' }
    }
    const latest = new Map<string, StoredChange>()
    for (const change of this.changes) {
      if (change.revision <= parsed.revision) continue
      latest.set(change.unitId, change)
    }
    const changes: ActivityChange[] = []
    for (const change of latest.values()) {
      if (change.removed) {
        changes.push({ unitId: change.unitId, removed: true })
        continue
      }
      const row = this.rows.get(change.unitId)
      if (row) changes.push({ unitId: change.unitId, row })
    }
    return {
      resetRequired: false,
      batch: { cursor: this.cursor(), changes }
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

  record(event: RuntimeEvent): void {
    this.lastEventAt.set(event.threadId, Date.now())
    const projections = projectRuntimeEvent(event)
    for (const projection of projections) {
      if (!this.rows.has(projection.unitId)) {
        this.autoRegister(event, projection.unitId)
      }
      if (projection.patch.lastMessagePreview !== undefined) {
        this.applyPreviewThrottled(projection.unitId, projection.patch.lastMessagePreview)
        continue
      }
      this.applyRuntime(event, projection.unitId, projection.patch)
    }
  }

  /**
   * Rebuild structured rows from durable thread/turn state after a restart
   * (docs/ade/06 §8). Only threads touched in the last 7 days are rebuilt;
   * the persisted turn status is the truth, so rows are not marked
   * restoredUnconfirmed.
   */
  async hydrate(store: {
    list(options?: { limit?: number }): Promise<Array<{ id: string }>>
    getMetadata?(threadId: string): Promise<ThreadRecord | null>
  }): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60_000
    const limit = this.options.maxRows ?? DEFAULT_MAX_ROWS
    const threads = await store.list({ limit }).catch(() => [])
    for (const summary of threads) {
      if (this.rows.has(summary.id)) continue
      const record = await store.getMetadata?.(summary.id).catch(() => null)
      if (!record) continue
      if (Date.parse(record.updatedAt) < cutoff) continue
      const lastTurn = record.turns[record.turns.length - 1]
      if (!lastTurn) continue
      const patch = hydratedState(lastTurn.status)
      if (!patch.mainState) continue
      this.register({
        unitId: record.id,
        kind: 'thread',
        threadId: record.id,
        ...(record.parentThreadId ? { parentThreadId: record.parentThreadId } : {}),
        harnessId: record.harnessId ?? 'kun',
        title: record.title,
        workspace: { path: record.workspace, kind: 'local' },
        mainState: patch.mainState,
        ...(patch.lastOutcome ? { lastOutcome: patch.lastOutcome } : {}),
        turnId: lastTurn.id,
        provenance: 'restored',
        visibility: record.status === 'archived' ? 'archived' : 'active'
      })
    }
  }

  private applyRuntime(event: RuntimeEvent, unitId: string, patch: ActivityPatch): void {
    const row = this.rows.get(unitId)
    if (row?.stalled) patch = { stalled: false, ...patch }
    this.apply(unitId, patch, 'runtime')
  }

  /**
   * Normal threads auto-register on their first turn_started; child units
   * appearing through `event.child` register as workers on their parent.
   * Both get filled in from thread metadata once it resolves.
   */
  private autoRegister(event: RuntimeEvent, unitId: string): void {
    if (unitId === event.threadId && event.kind === 'turn_started') {
      this.register({
        unitId,
        kind: 'thread',
        threadId: event.threadId,
        harnessId: 'kun',
        title: unitId,
        workspace: { path: '', kind: 'directory' }
      })
      void this.fillMetadata(unitId, event.threadId)
      return
    }
    const child = event.child
    if (child && unitId === child.childId) {
      this.register({
        unitId,
        kind: 'worker',
        threadId: child.childId,
        parentThreadId: child.parentThreadId,
        harnessId: 'kun',
        title: (child.childLabel ?? child.childId).slice(0, 200),
        workspace: { path: '', kind: 'directory' }
      })
      void this.fillMetadata(unitId, child.childId)
    }
  }

  private async fillMetadata(unitId: string, threadId: string): Promise<void> {
    const metadata = await this.options.threadMetadata?.(threadId).catch(() => null)
    if (!metadata || !this.rows.has(unitId)) return
    this.apply(unitId, {
      title: metadata.title.slice(0, 200),
      workspace: {
        path: metadata.workspace,
        kind: metadata.forkedFromThreadId ? 'worktree' : 'local'
      },
      ...(metadata.harnessId ? { harnessId: metadata.harnessId } : {}),
      ...(metadata.parentThreadId ? { parentThreadId: metadata.parentThreadId } : {}),
      ...(metadata.status === 'archived' ? { visibility: 'archived' as const } : {})
    }, 'runtime')
  }

  private applyPreviewThrottled(unitId: string, text: string): void {
    this.pendingPreview.set(unitId, text)
    const nowMs = this.options.nowMs?.() ?? Date.now()
    const throttle = this.options.previewThrottleMs ?? DEFAULT_PREVIEW_THROTTLE_MS
    const last = this.lastPreviewAt.get(unitId) ?? 0
    const remaining = throttle - (nowMs - last)
    if (remaining <= 0) {
      this.flushPreview(unitId)
      return
    }
    if (this.previewTimers.has(unitId)) return
    const timer = setTimeout(() => this.flushPreview(unitId), remaining)
    timer.unref?.()
    this.previewTimers.set(unitId, timer)
  }

  private flushPreview(unitId: string): void {
    const timer = this.previewTimers.get(unitId)
    if (timer) {
      clearTimeout(timer)
      this.previewTimers.delete(unitId)
    }
    const text = this.pendingPreview.get(unitId)
    if (text === undefined) return
    this.pendingPreview.delete(unitId)
    this.lastPreviewAt.set(unitId, this.options.nowMs?.() ?? Date.now())
    this.apply(unitId, { lastMessagePreview: text.slice(-PREVIEW_MAX) }, 'runtime')
  }

  private recomputeParent(parentThreadId: string): void {
    const parent = this.rows.get(parentThreadId)
    if (!parent) return
    const children: ActivityChildren = { working: 0, waiting: 0, done: 0, failed: 0 }
    for (const row of this.rows.values()) {
      if (row.parentThreadId !== parentThreadId) continue
      const bucket = childBucket(row.state)
      if (bucket) children[bucket] += 1
    }
    if (
      children.working === parent.children.working &&
      children.waiting === parent.children.waiting &&
      children.done === parent.children.done &&
      children.failed === parent.children.failed
    ) {
      return
    }
    const now = this.options.nowIso()
    const next: ActivityRow = { ...parent, children, updatedAt: now }
    next.state = rollupState(next.mainState, next.children, next.waitingReason)
    if (next.state !== parent.state) next.stateSince = now
    this.rows.set(parentThreadId, next)
    this.bump(parentThreadId)
    if (next.parentThreadId) this.recomputeParent(next.parentThreadId)
  }

  private bump(unitId: string, removed?: boolean): void {
    this.revision += 1
    this.changes.push({ unitId, revision: this.revision, ...(removed ? { removed } : {}) })
    const capacity = this.options.changesCapacity ?? DEFAULT_CHANGES_CAPACITY
    while (this.changes.length > capacity) this.changes.shift()
    for (const listener of this.listeners) listener()
  }

  /**
   * Over-capacity eviction (docs/ade/06 §8): archived+closed rows idle for
   * 7+ days go first, then the oldest idle rows.
   */
  private evict(): void {
    const maxRows = this.options.maxRows ?? DEFAULT_MAX_ROWS
    if (this.rows.size <= maxRows) return
    const cutoff = Date.now() - ARCHIVED_CLOSED_EVICT_MS
    for (const row of this.rows.values()) {
      if (this.rows.size <= maxRows) break
      if (
        row.visibility === 'archived' &&
        row.state === 'closed' &&
        Date.parse(row.stateSince) < cutoff
      ) {
        this.remove(row.unitId)
      }
    }
    if (this.rows.size <= maxRows) return
    const idle = [...this.rows.values()]
      .filter((row) => row.state === 'idle' || row.state === 'closed')
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    for (const row of idle) {
      if (this.rows.size <= maxRows) break
      this.remove(row.unitId)
    }
  }
}

const PREVIEW_MAX = 200

function mergeRow(
  row: ActivityRow,
  patch: ActivityPatch,
  provenance: ActivityProvenance,
  now: string
): ActivityRow {
  const next: ActivityRow = { ...row }
  let touched = false
  for (const key of Object.keys(patch) as Array<keyof ActivityPatch>) {
    const value = patch[key]
    if ((next as Record<string, unknown>)[key] !== value) {
      ;(next as Record<string, unknown>)[key] = value
      touched = true
    }
  }
  if (!touched) return row
  next.updatedAt = now
  next.provenance = provenance
  return next
}

function rowsEqual(a: ActivityRow, b: ActivityRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ActivityRow>
  for (const key of keys) {
    if (key === 'children') {
      if (
        a.children.working !== b.children.working ||
        a.children.waiting !== b.children.waiting ||
        a.children.done !== b.children.done ||
        a.children.failed !== b.children.failed
      ) {
        return false
      }
      continue
    }
    if (key === 'workspace') {
      if (
        a.workspace.path !== b.workspace.path ||
        a.workspace.kind !== b.workspace.kind ||
        a.workspace.branch !== b.workspace.branch
      ) {
        return false
      }
      continue
    }
    if (a[key] !== b[key]) return false
  }
  return true
}

function childBucket(state: ActivityState): keyof ActivityChildren | null {
  switch (state) {
    case 'initializing':
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'done':
    case 'idle':
    case 'closed':
      return 'done'
    default:
      return null
  }
}

function hydratedState(status: string): { mainState?: ActivityState; lastOutcome?: 'completed' | 'failed' | 'cancelled' } {
  switch (status) {
    case 'queued':
      return { mainState: 'initializing' }
    case 'running':
      return { mainState: 'working' }
    case 'completed':
      return { mainState: 'done', lastOutcome: 'completed' }
    case 'failed':
      return { mainState: 'failed', lastOutcome: 'failed' }
    case 'aborted':
      return { mainState: 'idle', lastOutcome: 'cancelled' }
    default:
      return {}
  }
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
