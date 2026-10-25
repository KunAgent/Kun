// Local record of tasks Kun assigned to assistants and of what came back. It is the desktop's
// copy of the conversation: the mailbox server deletes each message once it is acknowledged.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import type { PreparedMessage } from '@kun/assistant-agent'
import { dirname } from 'node:path'
import type {
  AssistantNoteView, AssistantTaskStatus, AssistantTaskUpdate, AssistantTaskView
} from '../../shared/assistant-mailbox'

const MAX_TASKS = 200
const MAX_NOTES = 200
const MAX_SEEN = 2000

type StoredUpdate = AssistantTaskUpdate & { messageId: string }
type StoredTask = Omit<AssistantTaskView, 'updates'> & { updates: StoredUpdate[] }
type TaskFile = { version: 1; tasks: StoredTask[]; notes: AssistantNoteView[]; seen: string[]; pending?: PreparedMessage[] }

/** A decrypted message from an assistant, as delivered by `AssistantHost.receive`. */
export type IncomingAssistantMessage = {
  id: string
  kind: 'task' | 'note' | 'reply' | 'cancel'
  createdAt: string
  body: string
  title?: string
  inReplyTo?: string
  status?: AssistantTaskUpdate['status']
}

export class AssistantTaskStore {
  private cache: TaskFile | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string) {}

  private async load(): Promise<TaskFile> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as TaskFile
      this.cache = parsed.version === 1 ? parsed : { version: 1, tasks: [], notes: [], seen: [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = { version: 1, tasks: [], notes: [], seen: [] }
    }
    return this.cache
  }

  private mutate<T>(change: (file: TaskFile) => T): Promise<T> {
    const work = async (): Promise<T> => {
      const file = structuredClone(await this.load())
      const result = change(file)
      const recent = new Set(file.tasks.slice(-MAX_TASKS).map((task) => task.id))
      const pending = new Set(file.pending?.map((item) => item.message.id))
      file.tasks = file.tasks.filter((task) => recent.has(task.id) || pending.has(task.id))
      file.notes = file.notes.slice(-MAX_NOTES)
      file.seen = file.seen.slice(-MAX_SEEN)
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      const handle = await open(temporary, 'w', 0o600)
      try { await handle.writeFile(JSON.stringify(file)); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.path)
      this.cache = file
      return result
    }
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  /** The task and exact sealed envelope are committed together before any network send. */
  queueTask(prepared: PreparedMessage, assistantName: string): Promise<AssistantTaskView> {
    return this.mutate((file) => {
      const { message } = prepared
      const existing = file.tasks.find((task) => task.id === message.id)
      if (existing) return existing
      const task: StoredTask = {
        id: message.id, assistantId: prepared.assistantId, assistantName,
        title: message.title ?? '', body: message.body, createdAt: message.createdAt,
        updatedAt: message.createdAt, status: 'queued', updates: [],
        ...(message.deadline ? { deadline: message.deadline } : {})
      }
      file.tasks.push(task)
      ;(file.pending ??= []).push(prepared)
      return task
    })
  }

  async pendingTasks(): Promise<PreparedMessage[]> {
    return structuredClone((await this.load()).pending ?? [])
  }

  finishDelivery(id: string, error?: string): Promise<void> {
    return this.mutate((file) => {
      file.pending = (file.pending ?? []).filter((item) => item.message.id !== id)
      const task = file.tasks.find((item) => item.id === id)
      if (task?.status === 'queued') {
        task.status = error ? 'failed' : 'sent'
        task.updatedAt = new Date().toISOString()
        if (error) task.updates.push({ messageId: id, status: 'failed', body: error, at: task.updatedAt })
      }
    })
  }

  async task(taskId: string): Promise<AssistantTaskView | undefined> {
    return (await this.load()).tasks.find((task) => task.id === taskId)
  }

  addTask(task: Omit<AssistantTaskView, 'updates' | 'updatedAt' | 'status'>): Promise<AssistantTaskView> {
    return this.mutate((file) => {
      const stored: StoredTask = { ...task, status: 'sent', updatedAt: task.createdAt, updates: [] }
      file.tasks.push(stored)
      return stored
    })
  }

  markCancelled(taskId: string, now = new Date()): Promise<AssistantTaskView | undefined> {
    return this.mutate((file) => {
      const task = file.tasks.find((item) => item.id === taskId)
      if (!task) return undefined
      task.status = 'cancelled'
      task.updatedAt = now.toISOString()
      return task
    })
  }

  /** Applies one incoming message once; replies update their task, anything else is a note. */
  applyIncoming(assistant: { id: string; name: string }, message: IncomingAssistantMessage): Promise<void> {
    return this.mutate((file) => {
      if (file.seen.includes(message.id)) return
      file.seen.push(message.id)
      const task = message.kind === 'reply' && message.inReplyTo
        ? file.tasks.find((item) => item.id === message.inReplyTo && item.assistantId === assistant.id)
        : undefined
      if (task && message.status) {
        task.updates.push({ messageId: message.id, status: message.status, body: message.body, at: message.createdAt })
        if (task.status !== 'cancelled') task.status = message.status as AssistantTaskStatus
        task.updatedAt = message.createdAt
        return
      }
      file.notes.push({
        id: message.id, from: 'assistant', assistantId: assistant.id, assistantName: assistant.name, body: message.body, at: message.createdAt,
        ...(message.title ? { title: message.title } : {}), ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {})
      })
    })
  }

  /** Records a message the user sent about a task, so it shows in that assistant's conversation. */
  addOutgoingNote(note: Omit<AssistantNoteView, 'from'>): Promise<void> {
    return this.mutate((file) => {
      if (file.seen.includes(note.id)) return
      file.seen.push(note.id)
      file.notes.push({ ...note, from: 'you' })
    })
  }

  /** Most recent first; `names` refreshes display names of assistants that were renamed. */
  async view(names: ReadonlyMap<string, string>, limit = 50): Promise<{ tasks: AssistantTaskView[]; notes: AssistantNoteView[] }> {
    const file = await this.load()
    const name = (id: string, fallback: string) => names.get(id) ?? fallback
    return {
      tasks: file.tasks.slice(-limit).reverse().map(({ updates, ...task }) => ({
        ...task, assistantName: name(task.assistantId, task.assistantName),
        updates: updates.map(({ status, body, at }) => ({ status, body, at }))
      })),
      notes: file.notes.slice(-limit).reverse().map((note) => ({ ...note, from: note.from ?? 'assistant', assistantName: name(note.assistantId, note.assistantName) }))
    }
  }
}
