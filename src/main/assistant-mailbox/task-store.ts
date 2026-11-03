// Durable desktop projection and outbox. History is paged for display, never trimmed by count.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PreparedMessage } from '@kun/assistant-agent'
import type { AssistantHistoryPage, AssistantNoteView, AssistantTaskStatus, AssistantTaskUpdate, AssistantTaskView, AssistantTaskQuery, AssistantTaskPage, AssistantTaskDetails, AssistantTaskSource } from '../../shared/assistant-mailbox'
const TERMINAL = new Set<AssistantTaskStatus>(['done', 'failed', 'cancelled'])
type StoredTask = Omit<AssistantTaskView, 'updates'> & { updates: Array<AssistantTaskUpdate & { messageId: string }>; statusRevision?: number; reportedRevision?: number }
type Delivery = { assistantId: string; taskId?: string; kind: string; restored?: boolean; storedAt?: string; receivedAt?: string; consumedAt?: string; error?: string }
type TaskFile = { version: 1 | 2; statusRevision?: number; failed?: PreparedMessage[]; tasks: StoredTask[]; notes: AssistantNoteView[]; seen: string[]; pending?: PreparedMessage[]; deliveries?: Record<string, Delivery>; cursors?: Record<string, number> }
export type IncomingAssistantMessage = {
  id: string; kind: 'task' | 'note' | 'reply' | 'cancel'; createdAt: string; body: string; title?: string; inReplyTo?: string; status?: AssistantTaskUpdate['status']
}
function advance(current: AssistantTaskStatus, incoming: AssistantTaskUpdate['status']): AssistantTaskStatus {
  if (TERMINAL.has(current)) return current
  if (incoming === 'received' && !['queued', 'sent', 'received'].includes(current)) return current
  if (current === 'cancel_requested' && !['done', 'failed'].includes(incoming)) return current
  return incoming
}
export class AssistantTaskStore {
  private cache: TaskFile | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}
  private async load(): Promise<TaskFile> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as TaskFile
      if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.notes) || !Array.isArray(parsed.seen)) throw new Error('ASSISTANT_STORE_UNSUPPORTED')
      this.cache = { ...parsed, version: 2, failed: parsed.failed ?? [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = { version: 2, tasks: [], notes: [], seen: [], failed: [] }
    }
    return this.cache
  }
  private mutate<T>(change: (file: TaskFile) => T): Promise<T> {
    const work = async (): Promise<T> => {
      const previous = await this.load(), file = structuredClone(previous), result = change(file)
      const old = new Map(previous.tasks.map(task => [task.id, task]))
      for (const task of file.tasks) {
        const prior = old.get(task.id)
        if (!task.statusRevision || !prior || prior.status !== task.status || prior.updatedAt !== task.updatedAt || Boolean(prior.archived) !== Boolean(task.archived)) {
          file.statusRevision = Math.max(file.statusRevision ?? 0, Date.now()) + 1
          task.statusRevision = file.statusRevision
        }
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(file)); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.path)
      if (process.platform !== 'win32') { const directory = await open(dirname(this.path), 'r'); try { await directory.sync() } finally { await directory.close() } }
      this.cache = file
      return structuredClone(result)
    }
    const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next
  }
  async statusChanges(assistantId: string) {
    if ((await this.load()).tasks.some(task => !task.statusRevision)) await this.mutate(() => undefined)
    const file = await this.load()
    return structuredClone(file.tasks.filter(task => task.assistantId === assistantId && (task.statusRevision ?? 0) > (task.reportedRevision ?? 0)).map(task => ({
      taskId: task.id, revision: task.statusRevision!, state: task.status, createdAt: task.createdAt,
      updatedAt: task.updatedAt, archived: Boolean(task.archived)
    })))
  }
  markStatusReported(revisions: Array<{ taskId: string; revision: number }>): Promise<void> {
    return this.mutate(file => {
      const sent = new Map(revisions.map(item => [item.taskId, item.revision]))
      for (const task of file.tasks) {
        const revision = sent.get(task.id)
        if (revision && task.statusRevision === revision) task.reportedRevision = revision
      }
    })
  }
  rebaseStatusRevision(taskId: string, attempted: number, floor: number): Promise<void> {
    return this.mutate(file => {
      const task = file.tasks.find(item => item.id === taskId)
      if (!task || task.statusRevision !== attempted) return
      file.statusRevision = Math.max(file.statusRevision ?? 0, floor, Date.now()) + 1
      task.statusRevision = file.statusRevision
    })
  }
  private enqueue(file: TaskFile, prepared: PreparedMessage): void {
    const existing = file.pending?.find(item => item.message.id === prepared.message.id)
    if (existing) { if (existing.envelope !== prepared.envelope) throw new Error('ASSISTANT_REQUEST_CONFLICT'); return }
    ;(file.pending ??= []).push(prepared)
    ;(file.deliveries ??= {})[prepared.message.id] = { assistantId: prepared.assistantId, kind: prepared.message.kind,
      taskId: prepared.message.kind === 'task' ? prepared.message.id : prepared.message.inReplyTo }
  }
  queueTask(prepared: PreparedMessage, assistantName: string, retryOf?: string, source?: AssistantTaskSource): Promise<AssistantTaskView> {
    return this.mutate(file => {
      const { message } = prepared, existing = file.tasks.find(t => t.id === message.id)
      if (existing) return existing
      const task: StoredTask = { id: message.id, assistantId: prepared.assistantId, assistantName, title: message.title ?? '', body: message.body,
        createdAt: message.createdAt, updatedAt: message.createdAt, status: 'queued', updates: [], ...(message.deadline ? { deadline: message.deadline } : {}), ...(retryOf ? { retryOf } : {}), ...(source ? { source, continuation: { enabled: false, state: 'disabled' as const } } : {}) }
      file.tasks.push(task); this.enqueue(file, prepared); return task
    })
  }
  queueNote(prepared: PreparedMessage, assistantName: string): Promise<void> {
    return this.mutate(file => {
      if (file.notes.some(n => n.id === prepared.message.id)) return
      const message = prepared.message
      file.notes.push({ id: message.id, from: 'you', assistantId: prepared.assistantId, assistantName, body: message.body,
        at: message.createdAt, inReplyTo: message.inReplyTo, delivery: 'queued' })
      this.enqueue(file, prepared)
    })
  }
  queueCancel(prepared: PreparedMessage): Promise<AssistantTaskView> {
    return this.mutate(file => {
      const task = file.tasks.find(t => t.id === prepared.message.inReplyTo && t.assistantId === prepared.assistantId)
      if (!task) throw new Error('TASK_NOT_FOUND')
      if (TERMINAL.has(task.status)) throw new Error('TASK_ALREADY_FINISHED')
      if (task.cancellationId) return task
      this.enqueue(file, prepared)
      task.cancellationId = prepared.message.id; task.status = 'cancel_requested'; task.updatedAt = prepared.message.createdAt
      return task
    })
  }
  async pendingNote(taskId: string, body: string): Promise<boolean> {
    return (await this.load()).pending?.some(p => p.message.kind === 'note' && p.message.inReplyTo === taskId && p.message.body === body) ?? false
  }
  async pendingTasks(): Promise<PreparedMessage[]> { return structuredClone((await this.load()).pending ?? []) }
  finishDelivery(id: string, error?: string): Promise<void> {
    return this.mutate(file => {
      const pending = file.pending?.find(p => p.message.id === id)
      file.pending = (file.pending ?? []).filter(p => p.message.id !== id)
      if (error && pending && !(file.failed ?? []).some(item => item.message.id === id)) (file.failed ??= []).push(pending)
      if (!error) file.failed = (file.failed ?? []).filter(item => item.message.id !== id)
      const now = new Date().toISOString()
      const delivery = (file.deliveries ??= {})[id] ?? (pending ? { assistantId: pending.assistantId, taskId: pending.message.kind === 'task' ? id : pending.message.inReplyTo, kind: pending.message.kind } : undefined)
      if (delivery) { file.deliveries[id] = delivery; if (error) delivery.error = error; else delivery.storedAt = now }
      const task = file.tasks.find(t => t.id === id)
      if (task?.status === 'queued') { task.status = error ? 'failed' : 'sent'; task.updatedAt = now }
      if (task && error) task.updates.push({ messageId: id, status: 'failed', body: error, at: now })
      const note = file.notes.find(n => n.id === id)
      if (note) { note.delivery = error ? 'failed' : 'stored'; note.deliveryError = error }
      if (delivery?.kind === 'cancel' && error) {
        const target = file.tasks.find(t => t.id === delivery.taskId)
        if (target) target.cancellationError = error
      }
    })
  }
  async deliveryIds(): Promise<string[]> {
    const file = await this.load()
    const current = Object.entries(file.deliveries ?? {}).filter(([, d]) => !d.consumedAt && !d.error && d.storedAt).map(([id]) => id)
    return [...new Set([...current, ...file.tasks.filter(t => !TERMINAL.has(t.status) && !file.deliveries?.[t.id]).map(t => t.id)])]
  }
  applyReceipts(receipts: Array<{ messageId: string; expired?: boolean; storedAt: string; receivedAt: string | null; consumedAt: string | null }>): Promise<void> {
    if (!receipts.length) return Promise.resolve()
    return this.mutate(file => {
      for (const receipt of receipts) {
        const legacyTask = file.tasks.find(t => t.id === receipt.messageId)
        const delivery = (file.deliveries ??= {})[receipt.messageId] ?? (legacyTask ? { assistantId: legacyTask.assistantId, taskId: legacyTask.id, kind: 'task' } : undefined)
        if (!delivery) continue
        file.deliveries[receipt.messageId] = delivery
        if (receipt.expired) {
          delivery.error = 'assistant_delivery_expired'
          if (legacyTask && !TERMINAL.has(legacyTask.status)) { legacyTask.status = 'failed'; legacyTask.updates.push({ messageId: receipt.messageId, status: 'failed', body: 'assistant_delivery_expired', at: new Date().toISOString() }) }
          continue
        }
        delivery.storedAt = receipt.storedAt
        if (receipt.receivedAt) delivery.receivedAt = receipt.receivedAt
        if (receipt.consumedAt) delivery.consumedAt = receipt.consumedAt
        const task = file.tasks.find(t => t.id === delivery.taskId && t.assistantId === delivery.assistantId)
        if (delivery.kind === 'task' && task) {
          task.delivery = { storedAt: delivery.storedAt, receivedAt: delivery.receivedAt, consumedAt: delivery.consumedAt }
          if (delivery.consumedAt && ['queued', 'sent'].includes(task.status)) task.status = 'received'
        }

        const note = file.notes.find(n => n.id === receipt.messageId)
        if (note) note.delivery = delivery.consumedAt ? 'consumed' : delivery.receivedAt ? 'downloaded' : 'stored'
      }
    })
  }
  async task(taskId: string): Promise<AssistantTaskView | undefined> { return structuredClone((await this.load()).tasks.find(t => t.id === taskId)) }
  async findTask(prefix: string): Promise<AssistantTaskView | undefined> {
    const matches = (await this.load()).tasks.filter(t => t.id === prefix || prefix.length >= 4 && t.id.startsWith(prefix))
    if (matches.length > 1) throw new Error('AMBIGUOUS_TASK_ID')
    return structuredClone(matches[0])
  }
  addTask(task: Omit<AssistantTaskView, 'updates' | 'updatedAt' | 'status'>): Promise<AssistantTaskView> {
    return this.mutate(file => { const stored: StoredTask = { ...task, status: 'sent', updatedAt: task.createdAt, updates: [] }; file.tasks.push(stored); return stored })
  }
  markCancelled(taskId: string, now = new Date()): Promise<AssistantTaskView | undefined> {
    return this.mutate(file => { const task = file.tasks.find(t => t.id === taskId); if (task && !TERMINAL.has(task.status)) { task.status = 'cancelled'; task.updatedAt = now.toISOString() }; return task })
  }
  applyIncoming(assistant: { id: string; name: string }, message: IncomingAssistantMessage): Promise<void> {
    return this.mutate(file => {
      if (file.seen.includes(message.id)) return
      file.seen.push(message.id)
      const task = message.kind === 'reply' && message.inReplyTo ? file.tasks.find(t => t.id === message.inReplyTo && t.assistantId === assistant.id) : undefined
      if (task && message.status) {
        if (message.status === 'done' && !TERMINAL.has(task.status)) task.terminalResultId = message.id
        task.updates.push({ messageId: message.id, status: message.status, body: message.body, at: message.createdAt })
        task.status = advance(task.status, message.status); task.updatedAt = new Date().toISOString(); return
      }
      file.notes.push({ id: message.id, from: 'assistant', assistantId: assistant.id, assistantName: assistant.name, body: message.body,
        at: message.createdAt, ...(message.title ? { title: message.title } : {}), ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}) })
    })
  }
  addOutgoingNote(note: Omit<AssistantNoteView, 'from'>): Promise<void> {
    return this.mutate(file => { if (file.seen.includes(note.id)) return; file.seen.push(note.id); file.notes.push({ ...note, from: 'you' }) })
  }
  restoreOutgoing(item: { assistant: { id: string; name: string }; message: PreparedMessage['message']; storedAt: string; receivedAt: string | null; consumedAt: string | null }): Promise<void> {
    return this.mutate(file => {
      const { message, assistant } = item
      if (file.deliveries?.[message.id]?.restored) return
      const delivery = (file.deliveries ??= {})[message.id] ?? { assistantId: assistant.id, kind: message.kind, taskId: message.kind === 'task' ? message.id : message.inReplyTo }
      file.deliveries[message.id] = { ...delivery, storedAt: item.storedAt, receivedAt: item.receivedAt ?? delivery.receivedAt, consumedAt: item.consumedAt ?? delivery.consumedAt, restored: true }
      if (message.kind === 'task' && !file.tasks.some(t => t.id === message.id)) {
        file.tasks.push({ id: message.id, assistantId: assistant.id, assistantName: assistant.name, title: message.title ?? '', body: message.body,
          createdAt: message.createdAt, updatedAt: message.createdAt, status: item.consumedAt ? 'received' : 'sent', updates: [], deadline: message.deadline })
      }
      if (message.kind === 'task') {
        const task = file.tasks.find(t => t.id === message.id)!
        task.delivery = { storedAt: item.storedAt, receivedAt: item.receivedAt ?? undefined, consumedAt: item.consumedAt ?? undefined }
        if (item.consumedAt && ['queued', 'sent'].includes(task.status)) task.status = 'received'
      } else if (message.kind === 'note' && !file.notes.some(n => n.id === message.id)) {
        file.notes.push({ id: message.id, assistantId: assistant.id, assistantName: assistant.name, from: 'you', body: message.body, at: message.createdAt,
          inReplyTo: message.inReplyTo, delivery: item.consumedAt ? 'consumed' : item.receivedAt ? 'downloaded' : 'stored' })
      } else if (message.kind === 'cancel') {
        const task = file.tasks.find(t => t.id === message.inReplyTo && t.assistantId === assistant.id)
        if (task && !TERMINAL.has(task.status)) { task.cancellationId = message.id; task.status = 'cancel_requested' }
      }
    })
  }
  async finalizeCancellations(): Promise<void> {
    const current = await this.load()
    if (!current.tasks.some(t => t.status === 'cancel_requested' && t.cancellationId && current.deliveries?.[t.cancellationId]?.consumedAt)) return
    await this.mutate(file => {
      for (const task of file.tasks) {
        const receipt = task.cancellationId ? file.deliveries?.[task.cancellationId] : undefined
        if (task.status === 'cancel_requested' && receipt?.consumedAt) { task.status = 'cancelled'; task.updatedAt = receipt.consumedAt }
      }
    })
  }

  setContinuation(id: string, enabled: boolean, goalCreatedAt?: string, sourceFingerprint?: string): Promise<AssistantTaskView> {
    return this.mutate(file => {
      const task = file.tasks.find(item => item.id === id)
      if (!task) throw new Error('TASK_NOT_FOUND')
      if (!task.source) throw new Error('CONTINUATION_SOURCE_UNAVAILABLE')
      if (enabled && ['completed', 'failed', 'revoked'].includes(task.continuation?.state ?? '')) throw new Error('CONTINUATION_ALREADY_FINISHED')
      task.continuation = { enabled, state: enabled ? 'enabled' : 'disabled', ...(enabled && goalCreatedAt && sourceFingerprint ? { goalCreatedAt, sourceFingerprint } : {}) }
      return task
    })
  }
  markContinuation(id: string, state: 'queued' | 'completed' | 'failed' | 'revoked', reason?: string): Promise<void> {
    return this.mutate(file => {
      const task = file.tasks.find(item => item.id === id)
      if (!task?.continuation?.enabled) return
      task.continuation = { ...task.continuation, enabled: state === 'queued', state, ...(reason ? { reason } : {}) }
    })
  }
  async continuationResult(id: string): Promise<{ id: string; body: string } | undefined> {
    const task = (await this.load()).tasks.find(item => item.id === id)
    const update = task?.updates.find(item => item.messageId === task.terminalResultId && item.status === 'done')
    return update ? { id: update.messageId, body: update.body } : undefined
  }
  async queuedContinuations(): Promise<AssistantTaskView[]> {
    return structuredClone((await this.load()).tasks.filter(task => task.source && task.continuation?.enabled && task.continuation.state === 'queued'))
  }
  async pendingContinuations(): Promise<AssistantTaskView[]> {
    return structuredClone((await this.load()).tasks.filter(task => task.source && task.status === 'done' && task.continuation?.enabled && task.continuation.state === 'enabled'))
  }
  retryDelivery(id: string): Promise<void> {
    return this.mutate(file => {
      const failed = (file.failed ?? []).find(item => item.message.id === id)
      if (!failed) throw new Error('RETRY_ENVELOPE_UNAVAILABLE')
      file.failed = (file.failed ?? []).filter(item => item.message.id !== id)
      this.enqueue(file, failed)
      const delivery = file.deliveries?.[id]
      if (delivery) { delete delivery.error; delete delivery.storedAt }
      const task = file.tasks.find(item => item.id === id)
      if (task?.status === 'failed' && !task.updates.some(update => update.messageId !== id && ['done', 'failed'].includes(update.status))) task.status = 'queued'
      const note = file.notes.find(item => item.id === id)
      if (note) { note.delivery = 'queued'; delete note.deliveryError }
      const target = failed.message.kind === 'cancel' ? file.tasks.find(item => item.id === failed.message.inReplyTo) : undefined
      if (target) delete target.cancellationError
    })
  }
  archiveTask(id: string, archived: boolean): Promise<void> {
    return this.mutate(file => {
      const task = file.tasks.find(item => item.id === id)
      if (!task) throw new Error('TASK_NOT_FOUND')
      task.archived = archived
    })
  }
  async taskDetails(id: string): Promise<AssistantTaskDetails | undefined> {
    const file = await this.load(), task = file.tasks.find(item => item.id === id)
    if (!task) return undefined
    return structuredClone({ task, notes: file.notes.filter(note => note.assistantId === task.assistantId && note.inReplyTo === task.id),
      retryable: (file.failed ?? []).filter(item => item.assistantId === task.assistantId && (item.message.id === task.id || item.message.inReplyTo === task.id))
        .map(item => ({ messageId: item.message.id, kind: item.message.kind as 'task' | 'note' | 'cancel' })) })
  }
  async listTasks(query: AssistantTaskQuery): Promise<AssistantTaskPage> {
    const file = await this.load(), needle = query.query?.trim().toLocaleLowerCase()
    const rows = file.tasks.filter(task => (!query.assistantId || task.assistantId === query.assistantId)
      && (!query.status || task.status === query.status) && (query.archived === true ? task.archived === true : task.archived !== true)
      && (!needle || (task.title + '\n' + task.body).toLocaleLowerCase().includes(needle))
      && (!query.from || task.createdAt >= query.from) && (!query.to || task.createdAt <= query.to))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .filter(task => !query.cursor || `${task.updatedAt}|${task.id}` < query.cursor)
    const limit = query.limit ?? 50, selected = rows.slice(0, limit)
    return { tasks: structuredClone(selected), hasMore: rows.length > limit,
      ...(rows.length > limit && selected.length ? { nextCursor: `${selected.at(-1)!.updatedAt}|${selected.at(-1)!.id}` } : {}) }
  }
  async getCursor(assistantId: string): Promise<number> { return (await this.load()).cursors?.[assistantId] ?? 0 }
  setCursor(assistantId: string, sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) return Promise.reject(new Error('INVALID_HISTORY_CURSOR'))
    return this.mutate(file => { (file.cursors ??= {})[assistantId] = sequence })
  }
  async view(names: ReadonlyMap<string, string>, limit = 50): Promise<{ tasks: AssistantTaskView[]; notes: AssistantNoteView[] }> {
    const file = await this.load(), name = (id: string, fallback: string) => names.get(id) ?? fallback
    return {
      tasks: [...file.tasks].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)).slice(0,limit).map(({ updates, ...task }) => ({
        ...task, assistantName: name(task.assistantId,task.assistantName), updates: updates.map(({status,body,at})=>({status,body,at})) })),
      notes: file.notes.slice(-limit).reverse().map(note=>({...note,from:note.from??'assistant',assistantName:name(note.assistantId,note.assistantName)}))
    }
  }
  async history(assistantId: string, before?: string, limit = 50): Promise<AssistantHistoryPage> {
    const file = await this.load()
    const entries = [...file.tasks.filter(t=>t.assistantId===assistantId).map(task=>({key:task.createdAt+'|'+task.id,task})),
      ...file.notes.filter(n=>n.assistantId===assistantId).map(note=>({key:note.at+'|'+note.id,note}))]
      .filter(entry=>!before||entry.key<before).sort((a,b)=>b.key.localeCompare(a.key))
    const selected=entries.slice(0,limit)
    return { tasks:selected.flatMap(entry=>'task' in entry?[structuredClone(entry.task)]:[]),notes:selected.flatMap(entry=>'note' in entry?[structuredClone(entry.note)]:[]),
      hasMore:entries.length>limit,nextCursor:entries.length>limit?selected.at(-1)?.key:undefined }
  }
}
