// Main-process owner of the assistant mailbox: enrolls assistants, assigns and cancels tasks,
// and collects replies on a timer. It acts as this desktop's remote host device (the same
// identity the phone link uses) with the signed-in Kun account's access token.
import { join } from 'node:path'
import { AssistantHost, MailboxRequestError, type AssistantSummary } from '@kun/assistant-agent'
import { RemoteApi } from '@kun/remote-protocol'
import type { DeviceIdentity } from '@kun/remote-protocol'
import { hasKunAccountSession, type KunAccountState } from '../../shared/kun-account'
import {
  ASSISTANT_BODY_MAX_BYTES, ASSISTANT_NAME_MAX, ASSISTANT_TITLE_MAX, isAssistantKind,
  type AssistantAssignRequest, type AssistantEnrollmentRequest, type AssistantEnrollmentResult,
  type AssistantMailboxAvailability, type AssistantMailboxStatus, type AssistantTaskView, type AssistantView
} from '../../shared/assistant-mailbox'
import { AssistantSecretStore, type SecretCipher } from './secret-store'
import { AssistantTaskStore } from './task-store'

const ACTIVE_POLL_MS = 60_000
const ENROLLING_POLL_MS = 20_000
const MAX_BACKOFF_MS = 10 * 60_000
const PROBE_TTL_MS = 10 * 60_000

export type AssistantMailboxDeps = {
  origin: string
  account: {
    getState(): Promise<KunAccountState>
    accessToken(force?: boolean): Promise<string | null>
    onState(listener: (state: KunAccountState) => void): () => void
  }
  identity(owner: string): Promise<DeviceIdentity>
  storageDir: string
  cipher: () => Promise<SecretCipher>
  fetch: typeof fetch
  deviceName: string
  platform: 'macos' | 'windows' | 'linux'
  /** The Lab switch; when off the service neither polls nor accepts operations. */
  enabled(): Promise<boolean> | boolean
  emit(status: AssistantMailboxStatus): void
  log(level: 'info' | 'warn', message: string, detail?: Record<string, unknown>): void
  now?: () => Date
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void }
}

type Session = {
  owner: string
  identity: DeviceIdentity
  host: AssistantHost
  secrets: AssistantSecretStore
  tasks: AssistantTaskStore
  registered?: Promise<void>
  assistants: AssistantSummary[]
  enrollments: AssistantMailboxStatus['enrollments']
}

export class AssistantMailboxError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code)
    this.name = 'AssistantMailboxError'
  }
}

function describe(error: unknown): string {
  if (error instanceof MailboxRequestError) return `${error.status} ${error.code}`
  return error instanceof Error ? error.message : String(error)
}

export class AssistantMailboxService {
  private session: Session | null = null
  private availability: AssistantMailboxAvailability = 'unknown'
  private probedAt = 0
  private lastSyncAt?: string
  private error?: string
  private timer: unknown = null
  private failures = 0
  private forceToken = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date
  private readonly timers: NonNullable<AssistantMailboxDeps['timers']>
  private readonly unsubscribe: () => void

  constructor(private readonly deps: AssistantMailboxDeps) {
    this.now = deps.now ?? (() => new Date())
    this.timers = deps.timers ?? {
      set: (callback, ms) => { const handle = setTimeout(callback, ms); handle.unref?.(); return handle },
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
    this.unsubscribe = deps.account.onState((state) => {
      const owner = hasKunAccountSession(state) ? state.user?.id : undefined
      if (this.session && owner !== this.session.owner) {
        this.session = null
        void this.refresh().catch(() => {})
      } else if (!this.session && owner && this.availability === 'login_required') {
        void this.refresh().catch(() => {})
      }
    })
  }

  dispose(): void {
    this.unsubscribe()
    if (this.timer) this.timers.clear(this.timer)
    this.timer = null
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  private async currentSession(): Promise<Session | null> {
    const state = await this.deps.account.getState()
    if (!hasKunAccountSession(state) || !state.user) {
      this.session = null
      return null
    }
    const owner = state.user.id
    if (this.session?.owner === owner) return this.session
    const dir = join(this.deps.storageDir, owner)
    const secrets = new AssistantSecretStore(join(dir, 'secrets.enc'), this.deps.cipher)
    const identity = await this.deps.identity(owner)
    const host = new AssistantHost({
      server: this.deps.origin,
      fetch: this.deps.fetch,
      now: this.now,
      secrets: { get: (id) => secrets.get(id), set: (id, secret) => secrets.set(id, secret, this.now()) },
      credentials: async () => {
        const force = this.forceToken
        this.forceToken = false
        const accessToken = await this.deps.account.accessToken(force)
        if (!accessToken) throw new AssistantMailboxError('LOGIN_REQUIRED')
        return { accessToken, deviceId: identity.id, deviceCredential: identity.credential }
      }
    })
    const session: Session = { owner, identity, host, secrets, tasks: new AssistantTaskStore(join(dir, 'tasks.json')), assistants: [], enrollments: [] }
    this.session = session
    return session
  }

  /** The host device may never have been registered if the phone link was never turned on. */
  private register(session: Session): Promise<void> {
    session.registered ??= new RemoteApi({
      origin: this.deps.origin,
      token: () => this.deps.account.accessToken(),
      identity: async () => session.identity,
      fetch: this.deps.fetch
    }).request('/devices', 'POST', { name: this.deps.deviceName, platform: this.deps.platform, role: 'host' })
      .then(() => undefined, (error: unknown) => {
        session.registered = undefined
        throw error
      })
    return session.registered
  }

  /** Runs a host call; a 401 retries once with a refreshed access token. */
  private async withHost<T>(work: (session: Session) => Promise<T>): Promise<T> {
    if (!(await this.deps.enabled())) throw new AssistantMailboxError('DISABLED')
    if (!(await this.probe())) throw new AssistantMailboxError('UNAVAILABLE')
    const session = await this.currentSession()
    if (!session) throw new AssistantMailboxError('LOGIN_REQUIRED')
    await this.register(session)
    try {
      return await work(session)
    } catch (error) {
      if (!(error instanceof MailboxRequestError) || error.status !== 401) throw error
      this.forceToken = true
      return work(session)
    }
  }

  /** Whether the server offers the mailbox: it answers 404 to every route while switched off. */
  private async probe(force = false): Promise<boolean> {
    if (!force && this.availability === 'available') return true
    if (!force && this.availability === 'unavailable' && Date.now() - this.probedAt < PROBE_TTL_MS) return false
    const response = await this.deps.fetch(`${this.deps.origin}/api/assistants/v1/status`, { method: 'GET', redirect: 'error' })
    await response.body?.cancel().catch(() => {})
    this.probedAt = Date.now()
    this.availability = response.status === 404 ? 'unavailable' : 'available'
    return this.availability === 'available'
  }

  private async sync(session: Session): Promise<void> {
    const listed = await session.host.list()
    const names = new Map(listed.assistants.map((assistant) => [assistant.id, assistant.name]))
    let received = 0
    let rejected = 0
    await session.host.receive(async (item) => {
      if (item.error) {
        rejected++
        return
      }
      received++
      await session.tasks.applyIncoming({ id: item.assistant.id, name: names.get(item.assistant.id) ?? item.assistant.name }, item.message)
    })
    if (rejected) this.deps.log('warn', 'Discarded assistant messages that failed authentication', { rejected })
    const latest = received ? await session.host.list() : listed
    session.assistants = latest.assistants
    session.enrollments = latest.enrollments
    await session.secrets.retain(new Set([...latest.assistants.map((a) => a.enrollmentId), ...latest.enrollments.map((e) => e.enrollmentId)]), this.now())
    this.lastSyncAt = this.now().toISOString()
  }

  private schedule(): void {
    if (this.timer) this.timers.clear(this.timer)
    this.timer = null
    const session = this.session
    if (!session || this.availability !== 'available') return
    const base = session.enrollments.length ? ENROLLING_POLL_MS : session.assistants.length ? ACTIVE_POLL_MS : 0
    if (!base) return
    const delay = Math.min(MAX_BACKOFF_MS, base * 2 ** this.failures)
    this.timer = this.timers.set(() => { this.timer = null; void this.refresh().catch(() => {}) }, delay)
  }

  /** Pulls replies and the assistant list, then publishes a fresh snapshot. Never throws for remote failures. */
  refresh(options: { probe?: boolean } = {}): Promise<AssistantMailboxStatus> {
    return this.serial(async () => {
      try {
        if (!(await this.deps.enabled())) {
          this.availability = 'disabled'
        } else if (await this.probe(options.probe)) {
          const session = await this.currentSession()
          if (session) {
            await this.withHost(async (current) => this.sync(current))
            this.availability = 'available'
          } else {
            this.availability = 'login_required'
          }
        }
        this.failures = 0
        this.error = undefined
      } catch (error) {
        if (error instanceof AssistantMailboxError && error.code === 'LOGIN_REQUIRED') this.availability = 'login_required'
        else {
          this.failures = Math.min(this.failures + 1, 6)
          this.error = describe(error)
          this.deps.log('warn', 'Assistant mailbox sync failed', { error: this.error })
        }
      }
      const status = await this.snapshot()
      this.schedule()
      this.deps.emit(status)
      return status
    })
  }

  async snapshot(): Promise<AssistantMailboxStatus> {
    const session = this.availability === 'available' ? this.session : null
    if (!session) {
      return { availability: this.availability, assistants: [], enrollments: [], tasks: [], notes: [], ...(this.error ? { error: this.error } : {}) }
    }
    const assistants: AssistantView[] = await Promise.all(session.assistants.map(async (assistant) => ({
      id: assistant.id, name: assistant.name, kind: isAssistantKind(assistant.kind) ? assistant.kind : 'other',
      platform: assistant.platform, agentVersion: assistant.agentVersion, createdAt: assistant.createdAt,
      lastSeenAt: assistant.lastSeenAt, pendingToAssistant: assistant.pendingToAssistant, pendingToHost: assistant.pendingToHost,
      keyAvailable: Boolean(await session.secrets.get(assistant.enrollmentId))
    })))
    const view = await session.tasks.view(new Map(assistants.map((assistant) => [assistant.id, assistant.name])))
    return {
      availability: this.availability, assistants, enrollments: session.enrollments, ...view,
      ...(this.lastSyncAt ? { lastSyncAt: this.lastSyncAt } : {}), ...(this.error ? { error: this.error } : {})
    }
  }

  async createEnrollment(request: AssistantEnrollmentRequest): Promise<AssistantEnrollmentResult> {
    const name = String(request?.name ?? '').trim()
    if (!name || name.length > ASSISTANT_NAME_MAX || [...name].some((char) => char.charCodeAt(0) < 0x20)) throw new AssistantMailboxError('INVALID_NAME')
    if (!isAssistantKind(request.kind)) throw new AssistantMailboxError('INVALID_KIND')
    const locale = request.locale === 'en' ? 'en' : 'zh'
    return this.serial(async () => {
      const created = await this.withHost((session) => session.host.createEnrollment({ name, kind: request.kind, locale }))
      if (this.session) this.session.enrollments = [...this.session.enrollments, { enrollmentId: created.enrollmentId, name, kind: request.kind, expiresAt: created.expiresAt }]
      this.schedule()
      this.deps.emit(await this.snapshot())
      return created
    })
  }

  async revoke(assistantId: string): Promise<AssistantMailboxStatus> {
    await this.serial(() => this.withHost((session) => session.host.revoke(assistantId)))
    return this.refresh()
  }

  private async findAssistant(session: Session, assistantId: string): Promise<AssistantSummary> {
    let assistant = session.assistants.find((item) => item.id === assistantId)
    if (!assistant) {
      session.assistants = (await session.host.list()).assistants
      assistant = session.assistants.find((item) => item.id === assistantId)
    }
    if (!assistant) throw new AssistantMailboxError('ASSISTANT_NOT_FOUND')
    return assistant
  }

  async assign(request: AssistantAssignRequest): Promise<AssistantTaskView> {
    const title = String(request?.title ?? '').trim()
    const body = String(request?.body ?? '')
    if (title.length > ASSISTANT_TITLE_MAX || /[\r\n]/.test(title)) throw new AssistantMailboxError('INVALID_TITLE')
    if (!body.trim() || Buffer.byteLength(body) > ASSISTANT_BODY_MAX_BYTES) throw new AssistantMailboxError('INVALID_BODY')
    if (request.deadline !== undefined && Number.isNaN(Date.parse(request.deadline))) throw new AssistantMailboxError('INVALID_DEADLINE')
    return this.serial(async () => {
      const task = await this.withHost(async (session) => {
        const assistant = await this.findAssistant(session, request.assistantId)
        const deadline = request.deadline === undefined ? undefined : new Date(request.deadline).toISOString()
        const message = await session.host.assign(assistant, { ...(title ? { title } : {}), body, ...(deadline ? { deadline } : {}) })
        return session.tasks.addTask({
          id: message.id, assistantId: assistant.id, assistantName: assistant.name, title, body,
          ...(deadline ? { deadline } : {}), createdAt: message.createdAt
        })
      })
      this.deps.emit(await this.snapshot())
      return task
    })
  }

  async cancel(taskId: string, reason = ''): Promise<AssistantTaskView> {
    return this.serial(async () => {
      const task = await this.withHost(async (session) => {
        const existing = await session.tasks.task(taskId)
        if (!existing) throw new AssistantMailboxError('TASK_NOT_FOUND')
        if (existing.status === 'cancelled') return existing
        const assistant = await this.findAssistant(session, existing.assistantId)
        await session.host.cancel(assistant, taskId, reason)
        return (await session.tasks.markCancelled(taskId, this.now()))!
      })
      this.deps.emit(await this.snapshot())
      return task
    })
  }
}
