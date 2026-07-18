import {
  AccountSchema,
  ComposerContextAttachmentRequestSchema,
  ComposerContextAttachmentSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  ExtensionApiError,
  ExtensionHostClient,
  ExtensionToolDeclarationSchema,
  GeneratedArtifactSchema,
  HostMessageSchema,
  JobCancelRequestSchema,
  JobEventSchema,
  JobFilterSchema,
  JobListRequestSchema,
  JobResultSchema,
  JobSnapshotSchema,
  JsonObjectSchema,
  JsonValueSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaMetadataSchema,
  MediaOpenViewResourceRequestSchema,
  MediaPickFilesRequestSchema,
  MediaPickSaveTargetRequestSchema,
  MediaProbeRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaReleaseRequestSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartArchiveJobRequestSchema,
  MediaVisualModelStatusSchema,
  ModelProviderDeclarationSchema,
  NetworkRequestSchema,
  NetworkResponseSchema,
  NotificationOptionsSchema,
  ProviderStatusSchema,
  ThemeSchema,
  LocaleSchema,
  createExtensionContext,
  hasPermission,
  toDisposable,
  type Account,
  type Activate,
  type AgentCreateRunRequest,
  type AgentRun,
  type AgentRunEvent,
  type Deactivate,
  type Disposable,
  type ExtensionContext,
  type ExtensionIdentity,
  type ExtensionToolDeclaration,
  type HostNotification,
  type HostRequestContext,
  type HostRequestHandler,
  type HostRequestOptions,
  type HostTransport,
  type GeneratedArtifact,
  type JobEvent,
  type JobListRequest,
  type JobResult,
  type JobResultInput,
  type JobSnapshot,
  type JsonObject,
  type JsonValue,
  type MediaAudioAnalysisCapabilities,
  type MediaVisualModelStatus,
  type MediaCapabilities,
  type ModelProviderDeclaration,
  type ModelProviderStreamEvent,
  type MediaMetadata,
  type MediaProbeResult,
  type NetworkResponse,
  type Permission,
  type ProviderStatus,
  type Theme,
  type Locale,
  type WorkspaceContext,
  type WorkspaceFile
} from '@kun/extension-api'
import { createHash } from 'node:crypto'

type FakeHostHandler = (
  params: JsonValue | undefined,
  options: HostRequestOptions
) => unknown | Promise<unknown>
type PermissionResolver = (params: JsonValue | undefined) => string | readonly string[] | undefined

export class FakeClock {
  #now: number

  constructor(now = Date.parse('2026-01-01T00:00:00.000Z')) {
    this.#now = now
  }

  now(): number {
    return this.#now
  }

  nowIso(): string {
    return new Date(this.#now).toISOString()
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('FakeClock can only advance by a positive duration')
    this.#now += ms
  }
}

export interface FakeTransportOptions {
  permissions?: Iterable<Permission | string>
}

export class FakeHostTransport implements HostTransport {
  readonly #hostHandlers = new Map<string, FakeHostHandler>()
  readonly #extensionHandlers = new Map<string, HostRequestHandler>()
  readonly #notificationListeners = new Set<(notification: HostNotification) => void>()
  readonly #permissionResolvers = new Map<string, PermissionResolver>()
  readonly permissions = new Set<string>()
  readonly sentNotifications: HostNotification[] = []
  readonly sentStreams: Array<{ requestId: string; payload: JsonValue; terminal: boolean }> = []
  readonly requests: Array<{ method: string; params?: JsonValue }> = []
  #disposed = false
  #nextInvocation = 1

  constructor(options: FakeTransportOptions = {}) {
    for (const permission of options.permissions ?? []) this.permissions.add(permission)
  }

  handle(method: string, handler: FakeHostHandler): Disposable {
    this.#hostHandlers.set(method, handler)
    return toDisposable(() => {
      this.#hostHandlers.delete(method)
    })
  }

  requirePermission(
    method: string,
    permission: string | readonly string[] | PermissionResolver
  ): void {
    this.#permissionResolvers.set(method, typeof permission === 'function' ? permission : () => permission)
  }

  grant(...permissions: string[]): void {
    for (const permission of permissions) this.permissions.add(permission)
  }

  deny(...permissions: string[]): void {
    for (const permission of permissions) this.permissions.delete(permission)
  }

  async request(
    method: string,
    params?: JsonValue,
    options: HostRequestOptions = {}
  ): Promise<unknown> {
    this.#assertActive()
    if (options.signal?.aborted) throw this.#cancelled(method)
    this.requests.push({ method, params })
    const required = this.#permissionResolvers.get(method)?.(params)
    const missing = (typeof required === 'string' ? [required] : required ?? [])
      .find((permission) => !hasPermission([...this.permissions], permission))
    if (missing) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: `Permission ${missing} is required for ${method}`,
        operation: method,
        retryable: false,
        details: { permission: missing }
      })
    }
    const handler = this.#hostHandlers.get(method)
    if (!handler) {
      throw new ExtensionApiError({
        code: 'UNSUPPORTED_CAPABILITY',
        message: `Fake Host has no handler for ${method}`,
        operation: method,
        retryable: false
      })
    }
    return handler(params, options)
  }

  notify(method: string, params?: JsonValue): void {
    this.#assertActive()
    this.sentNotifications.push({ method, params })
  }

  async sendStream(requestId: string, payload: JsonValue, terminal = false): Promise<void> {
    this.#assertActive()
    this.sentStreams.push({ requestId, payload, terminal })
  }

  onNotification(listener: (notification: HostNotification) => void): Disposable {
    this.#notificationListeners.add(listener)
    return toDisposable(() => {
      this.#notificationListeners.delete(listener)
    })
  }

  registerHandler(method: string, handler: HostRequestHandler): Disposable {
    if (this.#extensionHandlers.has(method)) throw new Error(`Duplicate extension handler: ${method}`)
    this.#extensionHandlers.set(method, handler)
    return toDisposable(() => {
      this.#extensionHandlers.delete(method)
    })
  }

  emit(method: string, params?: JsonValue): void {
    this.#assertActive()
    for (const listener of [...this.#notificationListeners]) listener({ method, params })
  }

  async invokeExtension(
    method: string,
    params?: JsonValue,
    options: HostRequestOptions = {}
  ): Promise<JsonValue> {
    this.#assertActive()
    const handler = this.#extensionHandlers.get(method)
    if (!handler) {
      throw new ExtensionApiError({
        code: 'NOT_FOUND',
        message: `Extension handler ${method} is not registered`,
        operation: method,
        retryable: false
      })
    }
    return handler(params, {
      signal: options.signal,
      requestId: `fake_request_${this.#nextInvocation++}`
    })
  }

  dispose(): void {
    this.#disposed = true
    this.#hostHandlers.clear()
    this.#extensionHandlers.clear()
    this.#notificationListeners.clear()
    this.sentStreams.splice(0)
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('FakeHostTransport is disposed')
  }

  #cancelled(operation: string): ExtensionApiError {
    return new ExtensionApiError({
      code: 'CANCELLED',
      message: `${operation} was cancelled`,
      operation,
      retryable: false
    })
  }
}

export class FakeStorageService {
  readonly global = new Map<string, JsonValue>()
  readonly workspace = new Map<string, JsonValue>()

  install(transport: FakeHostTransport): void {
    const store = (params: JsonValue | undefined) => {
      const parsed = JsonObjectSchema.parse(params)
      return parsed.scope === 'global' ? this.global : this.workspace
    }
    transport.handle('storage.get', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      const selected = store(params)
      const key = String(parsed.key)
      return selected.has(key) ? { found: true, value: selected.get(key) } : { found: false }
    })
    transport.handle('storage.set', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      store(params).set(String(parsed.key), JsonValueSchema.parse(parsed.value))
      return { ok: true }
    })
    transport.handle('storage.delete', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      return { deleted: store(params).delete(String(parsed.key)) }
    })
    transport.handle('storage.keys', (params) => [...store(params).keys()].sort())
  }
}

export class FakeWorkspaceService {
  readonly files = new Map<string, WorkspaceFile>()

  install(transport: FakeHostTransport): void {
    transport.handle('workspace.readFile', (params) => {
      const { path } = JsonObjectSchema.parse(params)
      const file = this.files.get(String(path))
      if (!file) throw notFound(`Workspace file ${String(path)} was not found`, 'workspace.readFile')
      return file
    })
    transport.handle('workspace.writeFile', (params) => {
      const file = params as unknown as WorkspaceFile
      this.files.set(file.path, file)
      return { ok: true }
    })
    transport.handle('workspace.stat', (params) => {
      const { path } = JsonObjectSchema.parse(params)
      const file = this.files.get(String(path))
      return file
        ? { path: file.path, type: 'file', size: file.content.length }
        : { path: String(path), type: 'directory', size: 0 }
    })
    transport.handle('workspace.list', (params) => {
      const { path = '.' } = JsonObjectSchema.parse(params)
      const prefix = String(path) === '.' ? '' : `${String(path).replace(/\/$/, '')}/`
      return [...this.files.values()]
        .filter((file) => file.path.startsWith(prefix))
        .map((file) => ({ path: file.path, type: 'file', size: file.content.length }))
    })
  }
}

export class FakeAgentService {
  readonly runs = new Map<string, AgentRun>()
  readonly events = new Map<string, AgentRunEvent[]>()
  readonly #subscriptions = new Map<string, string>()
  #nextRun = 1
  #nextSubscription = 1

  constructor(
    private readonly transport: FakeHostTransport,
    private readonly clock: FakeClock,
    private readonly identity: ExtensionIdentity
  ) {}

  install(): void {
    this.transport.handle('agent.createRun', (params) => this.createRun(AgentCreateRunRequestSchema.parse(params)))
    this.transport.handle('agent.getRun', (params) => this.getRun(String(JsonObjectSchema.parse(params).runId)))
    this.transport.handle('agent.subscribe', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      const runId = String(parsed.runId)
      this.getRun(runId)
      const subscriptionId = `subscription-${this.#nextSubscription++}`
      this.#subscriptions.set(subscriptionId, runId)
      const after = Number(parsed.afterSequence ?? 0)
      return {
        subscriptionId,
        replay: (this.events.get(runId) ?? []).filter((event) => event.sequence > after)
      }
    })
    this.transport.handle('agent.unsubscribe', (params) => {
      this.#subscriptions.delete(String(JsonObjectSchema.parse(params).subscriptionId))
      return { ok: true }
    })
    this.transport.handle('agent.steer', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      const run = this.getRun(String(parsed.runId))
      this.emit(run.id, 'steering-accepted', { steeringId: `steering-${this.clock.now()}` })
      return { accepted: true, run }
    })
    this.transport.handle('agent.cancel', (params) => {
      const run = this.getRun(String(JsonObjectSchema.parse(params).runId))
      if (!isTerminal(run.state)) {
        const updated: AgentRun = {
          ...run,
          state: 'cancelled',
          updatedAt: this.clock.nowIso(),
          terminalAt: this.clock.nowIso()
        }
        this.runs.set(run.id, updated)
        this.emit(run.id, 'terminal', { state: 'cancelled' })
      }
      return { accepted: true, run: this.getRun(run.id) }
    })
    this.transport.handle('threads.listOwn', () => ({
      items: [...this.runs.values()].map((run) => ({
        id: run.threadId,
        ownerExtensionId: run.ownerExtensionId,
        ownerExtensionVersion: run.ownerExtensionVersion,
        extensionVisibility: run.extensionVisibility,
        latestRun: run,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt
      })),
      page: { hasMore: false }
    }))
    this.transport.handle('threads.getOwn', (params) => {
      const threadId = String(JsonObjectSchema.parse(params).threadId)
      const run = [...this.runs.values()].find((candidate) => candidate.threadId === threadId)
      if (!run) throw notFound(`Thread ${threadId} was not found`, 'threads.getOwn')
      return {
        id: threadId,
        ownerExtensionId: run.ownerExtensionId,
        ownerExtensionVersion: run.ownerExtensionVersion,
        extensionVisibility: run.extensionVisibility,
        latestRun: run,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt
      }
    })
  }

  createRun(request: AgentCreateRunRequest): { run: AgentRun; createdThread: boolean } {
    const id = `run-${this.#nextRun++}`
    const threadId = request.threadId ?? `thread-${id}`
    const run: AgentRun = {
      id,
      threadId,
      ownerExtensionId: this.identity.id,
      ownerExtensionVersion: this.identity.version,
      accountId: request.providerBinding?.accountId,
      extensionVisibility: request.visibility ?? 'private',
      extensionProfile: request.profileId
        ? {
            id: request.profileId,
            instructionDigest: 'fake-profile-digest',
            providerBinding: request.providerBinding,
            allowedTools: request.allowedTools ?? [],
            budget: request.budget ?? {}
          }
        : undefined,
      extensionBudget: request.budget ?? {},
      toolCatalogEpoch: 'fake-epoch-1',
      state: 'running',
      providerBinding: request.providerBinding,
      createdAt: this.clock.nowIso(),
      updatedAt: this.clock.nowIso()
    }
    this.runs.set(id, run)
    this.events.set(id, [])
    this.emit(id, 'state', { state: 'running' })
    return { run, createdThread: !request.threadId }
  }

  getRun(runId: string): AgentRun {
    const run = this.runs.get(runId)
    if (!run) throw notFound(`Run ${runId} was not found`, 'agent.getRun')
    return run
  }

  emit(runId: string, type: AgentRunEvent['type'], fields: JsonObject = {}): AgentRunEvent {
    const run = this.getRun(runId)
    const list = this.events.get(runId) ?? []
    const event = AgentRunEventSchema.parse({
      runId,
      threadId: run.threadId,
      sequence: list.length + 1,
      timestamp: this.clock.nowIso(),
      type,
      ...fields
    })
    list.push(event)
    this.events.set(runId, list)
    for (const [subscriptionId, subscribedRun] of this.#subscriptions) {
      if (subscribedRun === runId) this.transport.emit('agent.event', { subscriptionId, event })
    }
    return event
  }
}

export function createGeneratedArtifactFixture(
  overrides: Partial<GeneratedArtifact> = {}
): GeneratedArtifact {
  return GeneratedArtifactSchema.parse({
    schemaVersion: 1,
    artifactId: 'fake_artifact_000001',
    ownerExtensionId: 'test.extension',
    ownerExtensionVersion: '1.1.0',
    workspaceId: 'test-workspace',
    mediaHandleId: 'fake_media_output_0001',
    displayName: 'output.mp4',
    mediaKind: 'video',
    mimeType: 'video/mp4',
    byteSize: 4096,
    completionIdentity: 'fake-completion-identity-0001',
    provenance: { jobId: 'fake-job-1', operation: 'media.ffmpeg' },
    ...overrides
  })
}

type FakeCancellationMode = 'immediate' | 'pending'

export class FakeJobService {
  readonly snapshots = new Map<string, JobSnapshot>()
  readonly events = new Map<string, JobEvent[]>()
  readonly #subscriptions = new Map<string, string>()
  cancellationMode: FakeCancellationMode = 'immediate'
  #nextJob = 1
  #nextSubscription = 1

  constructor(
    private readonly transport: FakeHostTransport,
    private readonly clock: FakeClock,
    private readonly identity: ExtensionIdentity,
    private readonly workspaceId: string
  ) {}

  install(): void {
    this.transport.handle('jobs.get', (params) =>
      this.get(String(JsonObjectSchema.parse(params).jobId)))
    this.transport.handle('jobs.list', (params) => this.list(JobListRequestSchema.parse(params)))
    this.transport.handle('jobs.subscribe', (params) => {
      const input = JsonObjectSchema.parse(params)
      const jobId = String(input.jobId)
      const snapshot = this.get(jobId)
      const subscriptionId = `job-subscription-${this.#nextSubscription++}`
      this.#subscriptions.set(subscriptionId, jobId)
      const retained = this.events.get(jobId) ?? []
      const afterCursor = input.afterCursor === undefined ? undefined : String(input.afterCursor)
      const afterIndex = afterCursor === undefined
        ? -1
        : retained.findIndex((event) => event.cursor === afterCursor)
      const gap = afterCursor !== undefined && afterIndex < 0
      const replay = retained.slice(gap ? 0 : afterIndex + 1)
      return {
        subscriptionId,
        snapshot,
        replay,
        cursor: snapshot.latestCursor,
        gap,
        complete: isTerminalJob(snapshot.state)
      }
    })
    this.transport.handle('jobs.unsubscribe', (params) => {
      this.#subscriptions.delete(String(JsonObjectSchema.parse(params).subscriptionId))
      return { ok: true }
    })
    this.transport.handle('jobs.cancel', (params) => {
      const request = JobCancelRequestSchema.parse(params)
      const snapshot = this.get(request.jobId)
      if (isTerminalJob(snapshot.state)) return { accepted: false, snapshot }
      const cancelRequestedAt = this.clock.nowIso()
      this.#replace({ ...snapshot, cancelRequestedAt, updatedAt: cancelRequestedAt })
      this.#append(request.jobId, 'cancellation-requested', snapshot.state)
      if (this.cancellationMode === 'immediate') this.settleCancellation(request.jobId)
      return { accepted: true, snapshot: this.get(request.jobId) }
    })
  }

  create(kind: string, initiatingOperation: string): JobSnapshot {
    const id = `fake-job-${this.#nextJob++}`
    const timestamp = this.clock.nowIso()
    const cursor = `${id}.1`
    const snapshot = JobSnapshotSchema.parse({
      schemaVersion: 1,
      id,
      kind,
      kindSchemaVersion: 1,
      ownerExtensionId: this.identity.id,
      ownerExtensionVersion: this.identity.version,
      workspaceId: this.workspaceId,
      initiatingOperation,
      state: 'queued',
      executionAttempt: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      latestCursor: cursor
    })
    this.snapshots.set(id, snapshot)
    this.events.set(id, [])
    this.#append(id, 'created', 'queued')
    return this.get(id)
  }

  get(jobId: string): JobSnapshot {
    const snapshot = this.snapshots.get(jobId)
    if (!snapshot) throw notFound(`Job ${jobId} was not found`, 'jobs.get')
    return structuredClone(snapshot)
  }

  list(request: JobListRequest = {}): {
    items: JobSnapshot[]
    page: { nextCursor?: string; hasMore: boolean }
  } {
    const parsed = JobListRequestSchema.parse(request)
    const filter = parsed.filter ? JobFilterSchema.parse(parsed.filter) : undefined
    const offset = parsed.cursor ? Number(parsed.cursor.slice('page_'.length)) : 0
    const matches = [...this.snapshots.values()]
      .filter((job) => !filter?.states || filter.states.includes(job.state))
      .filter((job) => !filter?.kinds || filter.kinds.includes(job.kind))
      .filter((job) => !filter?.workspaceId || filter.workspaceId === job.workspaceId)
      .filter((job) => !filter?.createdAfter || job.createdAt >= filter.createdAfter)
      .filter((job) => !filter?.createdBefore || job.createdAt <= filter.createdBefore)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
    const items = matches.slice(offset, offset + parsed.limit).map((item) => structuredClone(item))
    const nextOffset = offset + items.length
    return {
      items,
      page: nextOffset < matches.length
        ? { nextCursor: `page_${String(nextOffset).padStart(4, '0')}`, hasMore: true }
        : { hasMore: false }
    }
  }

  start(jobId: string): JobSnapshot {
    const snapshot = this.get(jobId)
    if (snapshot.state !== 'queued') return snapshot
    const timestamp = this.clock.nowIso()
    this.#replace({
      ...snapshot,
      state: 'running',
      executionAttempt: snapshot.executionAttempt + 1,
      startedAt: timestamp,
      updatedAt: timestamp
    })
    this.#append(jobId, 'state', 'running')
    return this.get(jobId)
  }

  reportProgress(
    jobId: string,
    progress: Omit<NonNullable<JobSnapshot['progress']>, 'updatedAt'>
  ): JobSnapshot {
    const snapshot = this.get(jobId)
    if (snapshot.state !== 'running') return snapshot
    const normalized = { ...progress, updatedAt: this.clock.nowIso() }
    this.#replace({ ...snapshot, progress: normalized, updatedAt: normalized.updatedAt })
    this.#append(jobId, 'progress', 'running', { progress: normalized })
    return this.get(jobId)
  }

  complete(jobId: string, result: JobResultInput = { schemaVersion: 1 }): JobSnapshot {
    const snapshot = this.get(jobId)
    if (isTerminalJob(snapshot.state) || snapshot.cancelRequestedAt) return snapshot
    const timestamp = this.clock.nowIso()
    const normalized = JobResultSchema.parse(result)
    this.#replace({
      ...snapshot,
      state: 'completed',
      result: normalized,
      updatedAt: timestamp,
      terminalAt: timestamp
    })
    this.#append(jobId, 'completed', 'completed', { result: normalized })
    return this.get(jobId)
  }

  fail(jobId: string, code = 'FAKE_JOB_FAILED', message = 'Fake job failed'): JobSnapshot {
    return this.#terminate(jobId, 'failed', 'failed', { code, message, retryable: false })
  }

  interrupt(jobId: string, message = 'Fake runtime restarted'): JobSnapshot {
    return this.#terminate(jobId, 'interrupted', 'interrupted', {
      code: 'FAKE_JOB_INTERRUPTED',
      message,
      retryable: true
    })
  }

  settleCancellation(jobId: string): JobSnapshot {
    const snapshot = this.get(jobId)
    if (isTerminalJob(snapshot.state)) return snapshot
    return this.#terminate(jobId, 'cancelled', 'cancelled')
  }

  simulateRestart(): void {
    this.#subscriptions.clear()
    for (const snapshot of [...this.snapshots.values()]) {
      if (snapshot.cancelRequestedAt) this.settleCancellation(snapshot.id)
      else if (snapshot.state === 'running') this.interrupt(snapshot.id)
    }
  }

  #terminate(
    jobId: string,
    state: 'failed' | 'cancelled' | 'interrupted',
    type: 'failed' | 'cancelled' | 'interrupted',
    error?: { code: string; message: string; retryable: boolean }
  ): JobSnapshot {
    const snapshot = this.get(jobId)
    if (isTerminalJob(snapshot.state)) return snapshot
    const timestamp = this.clock.nowIso()
    this.#replace({ ...snapshot, state, error, updatedAt: timestamp, terminalAt: timestamp })
    this.#append(jobId, type, state, error ? { error } : {})
    return this.get(jobId)
  }

  #replace(snapshot: JobSnapshot): void {
    this.snapshots.set(snapshot.id, JobSnapshotSchema.parse(snapshot))
  }

  #append(
    jobId: string,
    type: JobEvent['type'],
    state: JobSnapshot['state'],
    fields: Pick<JobEvent, 'progress' | 'result' | 'error'> | {} = {}
  ): JobEvent {
    const snapshot = this.snapshots.get(jobId)
    if (!snapshot) throw notFound(`Job ${jobId} was not found`, 'jobs.event')
    const list = this.events.get(jobId) ?? []
    const sequence = list.length + 1
    const cursor = `${jobId}.${sequence}`
    const event = JobEventSchema.parse({
      schemaVersion: 1,
      jobId,
      kind: snapshot.kind,
      type,
      state,
      timestamp: this.clock.nowIso(),
      executionAttempt: snapshot.executionAttempt,
      sequence,
      cursor,
      ...fields
    })
    list.push(event)
    this.events.set(jobId, list)
    this.#replace({ ...this.get(jobId), latestCursor: cursor })
    for (const [subscriptionId, subscribedJobId] of this.#subscriptions) {
      if (subscribedJobId === jobId) this.transport.emit('jobs.event', { subscriptionId, event })
    }
    return structuredClone(event)
  }
}

export class FakeMediaService {
  readonly handles = new Map<string, MediaMetadata>()
  readonly probes = new Map<string, MediaProbeResult>()
  readonly textContents = new Map<string, string>()
  readonly leases = new Map<string, { handleId: string; revoked: boolean }>()
  readonly #fileSelections: MediaMetadata[][] = []
  readonly #saveSelections: Array<MediaMetadata | undefined> = []
  executablesAvailable = true
  #capabilities: MediaCapabilities
  #audioAnalysisCapabilities: MediaAudioAnalysisCapabilities
  #visualModelStatus: MediaVisualModelStatus
  #nextLease = 1
  #nextCacheTarget = 1

  constructor(
    private readonly transport: FakeHostTransport,
    private readonly jobs: FakeJobService,
    private readonly clock: FakeClock
  ) {
    this.#capabilities = MediaCapabilitiesSchema.parse({
      probedAt: this.clock.nowIso(),
      ffprobe: {
        name: 'ffprobe',
        available: true,
        version: 'fake ffprobe 1.0',
        features: []
      },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        version: 'fake ffmpeg 1.0',
        features: [
          'libx264-encoder',
          'aac-encoder',
          'drawtext-filter',
          'subtitles-filter'
        ]
      }
    })
    this.#audioAnalysisCapabilities = MediaAudioAnalysisCapabilitiesSchema.parse({
      schemaVersion: 1,
      probedAt: this.clock.nowIso(),
      analyses: [
        {
          analysis: 'silence', available: true,
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'beat-grid', available: false,
          code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
          remediation: 'No verified local beat/downbeat analyzer is configured.',
          retryable: false, local: true, networkUsed: false
        },
        {
          analysis: 'sync-features', available: true,
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        }
      ]
    })
    this.#visualModelStatus = MediaVisualModelStatusSchema.parse({
      schemaVersion: 1,
      state: 'missing',
      descriptor: {
        adapterId: 'kun.local.visual-features', adapterVersion: '1.0.0',
        modelId: 'kun-visual-features', modelVersion: '1.0.0',
        packageId: 'kun-bundled.visual-features-v1', manifestSha256: 'a'.repeat(64),
        files: [{ name: 'visual-features-v1.json', sha256: 'b'.repeat(64), byteSize: 582 }],
        embeddingDimensions: 24, execution: 'local',
        querySemantics: 'bounded-visual-features-v1'
      },
      installSupported: false,
      checkedAt: this.clock.nowIso(),
      remediation: 'Configure an explicit verified visual model fixture before indexing.',
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
  }

  install(): void {
    this.transport.handle('media.pickFiles', (params) => {
      MediaPickFilesRequestSchema.parse(params)
      const files = this.#fileSelections.shift()
      return files && files.length > 0 ? { outcome: 'selected', files } : { outcome: 'cancelled', files: [] }
    })
    this.transport.handle('media.pickSaveTarget', (params) => {
      MediaPickSaveTargetRequestSchema.parse(params)
      const target = this.#saveSelections.shift()
      return target ? { outcome: 'selected', target } : { outcome: 'cancelled' }
    })
    this.transport.handle('media.createCacheTarget', (params) => {
      const request = MediaCreateCacheTargetRequestSchema.parse(params)
      const handleId = `fake_cache_target_${String(this.#nextCacheTarget++).padStart(4, '0')}`
      const metadata = MediaMetadataSchema.parse({
        handleId,
        mode: 'export',
        kind: request.format === 'wav'
          ? 'audio'
          : request.format === 'png' || request.format === 'jpeg'
            ? 'image'
            : 'video',
        displayName: `${request.purpose}.${request.format === 'jpeg' ? 'jpg' : request.format}`,
        mimeType: request.format === 'png'
          ? 'image/png'
          : request.format === 'jpeg'
            ? 'image/jpeg'
            : request.format === 'mp4'
              ? 'video/mp4'
              : request.format === 'webm'
                ? 'video/webm'
                : 'audio/wav',
        revoked: false
      })
      this.handles.set(handleId, metadata)
      return { target: metadata }
    })
    this.transport.handle('media.stat', (params) => {
      const handle = this.#get(MediaProbeRequestSchema.parse(params).handleId, 'media.stat')
      return handle
    })
    this.transport.handle('media.readText', (params) => {
      const request = MediaReadTextRequestSchema.parse(params)
      const handle = this.#get(request.handleId, 'media.readText')
      if (handle.mode !== 'read') throw notFound('Media handle is not readable', 'media.readText')
      const content = this.textContents.get(handle.handleId)
      if (content === undefined) throw notFound('Fake text content was not configured', 'media.readText')
      const byteSize = new TextEncoder().encode(content).byteLength
      if (byteSize > request.maxBytes) {
        throw new ExtensionApiError({
          code: 'RESOURCE_LIMIT',
          message: `Fake text content exceeds the ${request.maxBytes}-byte read limit`,
          operation: 'media.readText',
          retryable: false,
          details: { byteSize, maxBytes: request.maxBytes }
        })
      }
      return MediaReadTextResultSchema.parse({
        handleId: handle.handleId,
        displayName: handle.displayName,
        mimeType: handle.mimeType ?? 'text/plain',
        byteSize,
        content
      })
    })
    this.transport.handle('media.release', (params) => {
      const request = MediaReleaseRequestSchema.parse(params)
      if (request.resource === 'lease') {
        const lease = this.leases.get(request.leaseId)
        if (lease) lease.revoked = true
        return { released: lease !== undefined }
      }
      const handle = this.handles.get(request.handleId)
      if (handle) this.handles.set(request.handleId, { ...handle, revoked: true })
      return { released: handle !== undefined }
    })
    this.transport.handle('media.openViewResource', (params) => {
      const request = MediaOpenViewResourceRequestSchema.parse(params)
      const handle = this.#get(request.handleId, 'media.openViewResource')
      if (handle.mode !== 'read') throw notFound('Media handle is not readable', 'media.openViewResource')
      this.handles.set(handle.handleId, {
        ...handle,
        lastAccessedAt: this.clock.nowIso()
      })
      const leaseId = `fake_media_lease_${String(this.#nextLease++).padStart(4, '0')}`
      this.leases.set(leaseId, { handleId: handle.handleId, revoked: false })
      return {
        leaseId,
        handleId: handle.handleId,
        url: `kun-media://fake/${leaseId}`,
        mimeType: handle.mimeType ?? 'application/octet-stream',
        expiresAt: new Date(this.clock.now() + 60_000).toISOString()
      }
    })
    this.transport.handle('media.getCapabilities', () => {
      if (this.executablesAvailable) return structuredClone(this.#capabilities)
      return MediaCapabilitiesSchema.parse({
        probedAt: this.clock.nowIso(),
        ffprobe: { name: 'ffprobe', available: false, features: [] },
        ffmpeg: { name: 'ffmpeg', available: false, features: [] }
      })
    })
    this.transport.handle('media.getAudioAnalysisCapabilities', () => {
      if (this.executablesAvailable) return structuredClone(this.#audioAnalysisCapabilities)
      return MediaAudioAnalysisCapabilitiesSchema.parse({
        schemaVersion: 1,
        probedAt: this.clock.nowIso(),
        analyses: ['silence', 'beat-grid', 'sync-features'].map((analysis) => ({
          analysis,
          available: false,
          code: analysis === 'beat-grid'
            ? 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE'
            : 'AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE',
          remediation: 'Local audio analysis is unavailable in this fake Host.',
          retryable: analysis !== 'beat-grid',
          local: true,
          networkUsed: false
        }))
      })
    })
    this.transport.handle('media.getVisualModelStatus', () =>
      structuredClone(this.#visualModelStatus))
    this.transport.handle('media.installVisualModel', () =>
      structuredClone(this.#visualModelStatus))
    this.transport.handle('media.analyzeVisualFrames', (params) => {
      MediaAnalyzeVisualFramesRequestSchema.parse(params)
      return {
        outcome: 'unavailable',
        code: this.#visualModelStatus.state === 'installed'
          ? 'VISUAL_MEDIA_UNSUPPORTED'
          : 'VISUAL_MODEL_MISSING',
        remediation: 'Configure explicit measured visual frame evidence in this fake Host.',
        retryable: true,
        local: true,
        networkUsed: false
      }
    })
    this.transport.handle('media.embedVisualQuery', (params) => {
      MediaEmbedVisualQueryRequestSchema.parse(params)
      return {
        outcome: 'unavailable',
        code: this.#visualModelStatus.state === 'installed'
          ? 'VISUAL_QUERY_UNSUPPORTED'
          : 'VISUAL_MODEL_MISSING',
        remediation: 'Configure an explicit measured visual query fixture in this fake Host.',
        retryable: false,
        local: true,
        networkUsed: false
      }
    })
    this.transport.handle('media.probe', (params) => {
      if (!this.executablesAvailable) throw unavailable('media.probe')
      const request = MediaProbeRequestSchema.parse(params)
      this.#get(request.handleId, 'media.probe')
      const probe = this.probes.get(request.handleId)
      if (!probe) throw notFound('Fake probe output was not configured', 'media.probe')
      return probe
    })
    this.transport.handle('media.startFfmpegJob', (params) => {
      const request = MediaStartFfmpegJobRequestSchema.parse(params)
      const needsFfmpeg = request.arguments.length > 0 ||
        Object.keys(request.inputs).length > 0 ||
        Object.keys(request.outputs).length > 0
      if (!this.executablesAvailable && needsFfmpeg) throw unavailable('media.startFfmpegJob')
      for (const handleId of Object.values(request.inputs)) {
        const handle = this.#get(handleId, 'media.startFfmpegJob')
        if (handle.mode !== 'read') throw notFound('FFmpeg input is not readable', 'media.startFfmpegJob')
      }
      for (const handleId of Object.values(request.outputs)) {
        const handle = this.#get(handleId, 'media.startFfmpegJob')
        if (handle.mode !== 'export') throw notFound('FFmpeg output is not writable', 'media.startFfmpegJob')
      }
      for (const output of Object.values(request.textOutputs ?? {})) {
        const handle = this.#get(output.handleId, 'media.startFfmpegJob')
        if (handle.mode !== 'export') throw notFound('Text output is not writable', 'media.startFfmpegJob')
      }
      const job = this.jobs.create('media.ffmpeg', 'media.startFfmpegJob')
      return { job: { jobId: job.id, kind: job.kind, state: job.state, cursor: job.latestCursor } }
    })
    this.transport.handle('media.startAudioAnalysisJob', (params) => {
      const request = MediaStartAudioAnalysisJobRequestSchema.parse(params)
      const capability = (this.executablesAvailable
        ? this.#audioAnalysisCapabilities
        : MediaAudioAnalysisCapabilitiesSchema.parse({
            schemaVersion: 1,
            probedAt: this.clock.nowIso(),
            analyses: ['silence', 'beat-grid', 'sync-features'].map((analysis) => ({
              analysis,
              available: false,
              code: analysis === 'beat-grid'
                ? 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE'
                : 'AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE',
              remediation: 'Local audio analysis is unavailable in this fake Host.',
              retryable: analysis !== 'beat-grid',
              local: true,
              networkUsed: false
            }))
          })).analyses.find(({ analysis }) => analysis === request.analysis)!
      if (!capability.available) {
        return {
          outcome: 'unavailable',
          analysis: capability.analysis,
          code: capability.code,
          remediation: capability.remediation,
          retryable: capability.retryable,
          local: true,
          networkUsed: false
        }
      }
      const handles = request.analysis === 'sync-features'
        ? [request.referenceHandleId, request.targetHandleId]
        : [request.inputHandleId]
      for (const handleId of handles) {
        const handle = this.#get(handleId, 'media.startAudioAnalysisJob')
        if (handle.mode !== 'read') {
          throw notFound('Audio-analysis input is not readable', 'media.startAudioAnalysisJob')
        }
      }
      const job = this.jobs.create('media.audio-analysis', 'media.startAudioAnalysisJob')
      return {
        outcome: 'started',
        job: { jobId: job.id, kind: job.kind, state: job.state, cursor: job.latestCursor }
      }
    })
    this.transport.handle('media.startArchiveJob', (params) => {
      const request = MediaStartArchiveJobRequestSchema.parse(params)
      const output = this.#get(request.outputHandleId, 'media.startArchiveJob')
      if (output.mode !== 'export') {
        throw notFound('Archive output is not writable', 'media.startArchiveJob')
      }
      if (output.mimeType !== 'application/zip' && output.mimeType !== 'application/octet-stream') {
        throw notFound('Archive output must be a ZIP target', 'media.startArchiveJob')
      }
      for (const entry of request.entries) {
        if (entry.kind !== 'media') continue
        const input = this.#get(entry.inputHandleId, 'media.startArchiveJob')
        if (input.mode !== 'read') {
          throw notFound('Archive input is not readable', 'media.startArchiveJob')
        }
      }
      const job = this.jobs.create('media.archive', 'media.startArchiveJob')
      return {
        outcome: 'started',
        job: { jobId: job.id, kind: job.kind, state: job.state, cursor: job.latestCursor }
      }
    })
  }

  addHandle(metadata: unknown): MediaMetadata {
    const parsed = MediaMetadataSchema.parse(metadata)
    this.handles.set(parsed.handleId, parsed)
    return structuredClone(parsed)
  }

  queueFileSelection(...files: unknown[]): MediaMetadata[] {
    const parsed = files.map((file) => this.addHandle(file))
    this.#fileSelections.push(parsed)
    return parsed
  }

  queuePickerCancellation(): void {
    this.#fileSelections.push([])
  }

  queueSaveTarget(target?: unknown): MediaMetadata | undefined {
    const parsed = target ? this.addHandle(target) : undefined
    this.#saveSelections.push(parsed)
    return parsed
  }

  setProbe(handleId: string, result: unknown): MediaProbeResult {
    this.#get(handleId, 'media.setProbe')
    const parsed = MediaProbeResultSchema.parse(result)
    if (parsed.handleId !== handleId) throw new Error('Fake probe handleId must match the configured handle')
    this.probes.set(handleId, parsed)
    return structuredClone(parsed)
  }

  setText(handleId: string, content: string): string {
    const handle = this.#get(handleId, 'media.setText')
    if (handle.mode !== 'read') throw notFound('Fake text handle must be readable', 'media.setText')
    const byteSize = new TextEncoder().encode(content).byteLength
    this.handles.set(handleId, MediaMetadataSchema.parse({ ...handle, byteSize }))
    this.textContents.set(handleId, content)
    return content
  }

  setCapabilities(value: unknown): MediaCapabilities {
    const parsed = MediaCapabilitiesSchema.parse(value)
    this.#capabilities = parsed
    return structuredClone(parsed)
  }

  setAudioAnalysisCapabilities(value: unknown): MediaAudioAnalysisCapabilities {
    const parsed = MediaAudioAnalysisCapabilitiesSchema.parse(value)
    this.#audioAnalysisCapabilities = parsed
    return structuredClone(parsed)
  }

  setVisualModelStatus(value: unknown): MediaVisualModelStatus {
    const parsed = MediaVisualModelStatusSchema.parse(value)
    this.#visualModelStatus = parsed
    return structuredClone(parsed)
  }

  #get(handleId: string, operation: string): MediaMetadata {
    const handle = this.handles.get(handleId)
    if (!handle || handle.revoked) throw notFound('Media handle was not found', operation)
    return structuredClone(handle)
  }
}

export class FakeToolService {
  readonly registrations = new Map<string, ExtensionToolDeclaration>()
  #next = 1

  constructor(private readonly transport: FakeHostTransport) {}

  install(): void {
    this.transport.handle('tools.register', (params) => {
      const registrationId = `tool-${this.#next++}`
      this.registrations.set(registrationId, ExtensionToolDeclarationSchema.parse(params))
      return { registrationId }
    })
    this.transport.handle('tools.unregister', (params) => {
      this.registrations.delete(String(JsonObjectSchema.parse(params).registrationId))
      return { ok: true }
    })
  }

  invoke(registrationId: string, input: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    const declaration = this.registrations.get(registrationId)
    if (!declaration) throw notFound(`Tool ${registrationId} is not registered`, 'tools.invoke')
    return this.transport.invokeExtension(
      `tools.invoke:${registrationId}`,
      {
        invocationId: `invocation-${registrationId}`,
        toolId: declaration.id,
        input
      },
      { signal }
    )
  }
}

export class FakeProviderService {
  readonly registrations = new Map<string, ModelProviderDeclaration>()
  readonly statuses = new Map<string, ProviderStatus>()
  #next = 1

  constructor(
    private readonly transport: FakeHostTransport,
    private readonly clock: FakeClock
  ) {}

  install(): void {
    this.transport.handle('modelProviders.register', (params) => {
      const declaration = ModelProviderDeclarationSchema.parse(params)
      const registrationId = `provider-${this.#next++}`
      this.registrations.set(registrationId, declaration)
      this.statuses.set(declaration.id, {
        providerId: declaration.id,
        status: 'available',
        checkedAt: this.clock.nowIso()
      })
      return { registrationId }
    })
    this.transport.handle('modelProviders.unregister', (params) => {
      this.registrations.delete(String(JsonObjectSchema.parse(params).registrationId))
      return { ok: true }
    })
    this.transport.handle('modelProviders.getStatus', (params) => {
      const providerId = String(JsonObjectSchema.parse(params).providerId)
      return (
        this.statuses.get(providerId) ?? {
          providerId,
          status: 'unavailable',
          checkedAt: this.clock.nowIso()
        }
      )
    })
  }

  async invoke(
    registrationId: string,
    invocation: JsonObject,
    signal?: AbortSignal
  ): Promise<JsonValue> {
    return this.transport.invokeExtension(`modelProviders.invoke:${registrationId}`, invocation, { signal })
  }

  takeStreamEvents(registrationId: string): ModelProviderStreamEvent[] {
    const events = this.transport.sentStreams
      .map((item) => JsonObjectSchema.parse(item.payload))
      .filter((item) => item.kind === 'event')
      .filter((item) => item.registrationId === registrationId)
      .map((item) => item.event as unknown as ModelProviderStreamEvent)
    this.transport.sentStreams.splice(
      0,
      this.transport.sentStreams.length,
      ...this.transport.sentStreams.filter((item) => {
        const payload = JsonObjectSchema.parse(item.payload)
        return payload.registrationId !== registrationId
      })
    )
    return events
  }
}

export class FakeAccountService {
  readonly accounts = new Map<string, Account>()
  readonly secrets = new Map<string, string>()
  #nextSession = 1
  readonly sessions = new Map<string, JsonObject>()

  constructor(private readonly clock: FakeClock) {}

  addAccount(account: Omit<Account, 'createdAt' | 'updatedAt'>, secret?: string): Account {
    const parsed = AccountSchema.parse({
      ...account,
      createdAt: this.clock.nowIso(),
      updatedAt: this.clock.nowIso()
    })
    this.accounts.set(parsed.id, parsed)
    if (secret !== undefined) this.secrets.set(parsed.id, secret)
    return parsed
  }

  install(transport: FakeHostTransport): void {
    transport.handle('authentication.listAccounts', (params) => {
      const providerId = JsonObjectSchema.parse(params).providerId
      return [...this.accounts.values()].filter(
        (account) => providerId === undefined || account.providerId === providerId
      )
    })
    transport.handle('authentication.createSession', (params) => {
      const request = JsonObjectSchema.parse(params)
      const id = `account-session-${this.#nextSession++}`
      const session = { id, status: 'pending' as const, message: `Authorize ${String(request.providerId)}` }
      this.sessions.set(id, session)
      return session
    })
    transport.handle('authentication.getSession', (params) => {
      const id = String(JsonObjectSchema.parse(params).sessionId)
      const session = this.sessions.get(id)
      if (!session) throw notFound(`Account session ${id} was not found`, 'authentication.getSession')
      return session
    })
    transport.handle('authentication.cancelSession', (params) => {
      const id = String(JsonObjectSchema.parse(params).sessionId)
      this.sessions.set(id, { id, status: 'cancelled' })
      return { ok: true }
    })
    transport.handle('authentication.deleteAccount', (params) => {
      const id = String(JsonObjectSchema.parse(params).accountId)
      this.accounts.delete(id)
      this.secrets.delete(id)
      return { ok: true }
    })
    transport.handle('authentication.revealSecret', (params) => {
      const id = String(JsonObjectSchema.parse(params).accountId)
      const secret = this.secrets.get(id)
      if (!secret) throw notFound(`Secret for account ${id} was not found`, 'authentication.revealSecret')
      return { secret }
    })
    transport.handle('authentication.authenticatedFetch', (params) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: JsonObjectSchema.parse(params).accountId }),
      bodyEncoding: 'utf8',
      truncated: false
    }))
  }
}

export class FakeWebviewService {
  theme: Theme = ThemeSchema.parse({ kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false })
  locale: Locale = LocaleSchema.parse({ language: 'en', direction: 'ltr', messages: {} })
  state: JsonValue | undefined
  readonly messages: JsonValue[] = []
  readonly notifications: Array<{
    id: string
    title: string
    message: string
    severity: 'info' | 'warning' | 'error'
    actions: Array<{ id: string; title: string }>
  }> = []
  readonly composerContexts: Array<ReturnType<typeof ComposerContextAttachmentSchema.parse>> = []
  readonly #notificationResponses: Array<{ value?: string }> = []

  constructor(
    private readonly identity: ExtensionIdentity,
    private readonly workspaceId: string
  ) {}

  install(transport: FakeHostTransport): void {
    transport.handle('ui.getTheme', () => this.theme)
    transport.handle('ui.getLocale', () => this.locale)
    transport.handle('ui.getViewState', () =>
      this.state === undefined ? { found: false } : { found: true, value: this.state }
    )
    transport.handle('ui.setViewState', (params) => {
      this.state = JsonObjectSchema.parse(params).value
      return { ok: true }
    })
    transport.handle('ui.postMessage', (params) => {
      this.messages.push(HostMessageSchema.parse(params))
      return { ok: true }
    })
    transport.handle('ui.showNotification', (params) => {
      this.notifications.push(NotificationOptionsSchema.parse(params))
      return this.#notificationResponses.shift() ?? {}
    })
    transport.handle('ui.attachComposerContext', (params) => {
      const request = ComposerContextAttachmentRequestSchema.parse(params)
      const attachment = ComposerContextAttachmentSchema.parse({
        ...request,
        attachmentId: `extension-context:${createHash('sha256')
          .update(`${this.identity.id}\0${this.workspaceId}\0${request.id}`)
          .digest('hex')}`,
        provenance: {
          extensionId: this.identity.id,
          extensionVersion: this.identity.version,
          viewContributionId: `extension:${this.identity.id}/test-view`,
          workspaceId: this.workspaceId
        }
      })
      this.composerContexts.push(attachment)
      return attachment
    })
  }

  setTheme(transport: FakeHostTransport, theme: Theme): void {
    this.theme = ThemeSchema.parse(theme)
    transport.emit('ui.themeChanged', this.theme)
  }

  setLocale(transport: FakeHostTransport, locale: Locale): void {
    this.locale = LocaleSchema.parse(locale)
    transport.emit('ui.localeChanged', this.locale)
  }

  sendMessage(transport: FakeHostTransport, channel: string, payload: JsonValue): void {
    transport.emit('ui.message', { channel, payload })
  }

  respondToNextNotification(actionId?: string): void {
    this.#notificationResponses.push(actionId === undefined ? {} : { value: actionId })
  }
}

export interface ExtensionTestHarnessOptions {
  identity?: ExtensionIdentity
  permissions?: Iterable<Permission | string>
  workspace?: WorkspaceContext
  clock?: FakeClock
}

export class ExtensionTestHarness implements Disposable {
  readonly identity: ExtensionIdentity
  readonly permissions: Set<string>
  readonly clock: FakeClock
  readonly transport: FakeHostTransport
  readonly storage = new FakeStorageService()
  readonly workspace = new FakeWorkspaceService()
  readonly agent: FakeAgentService
  readonly jobs: FakeJobService
  readonly media: FakeMediaService
  readonly tools: FakeToolService
  readonly providers: FakeProviderService
  readonly accounts: FakeAccountService
  readonly webview: FakeWebviewService
  readonly configuration = new Map<string, JsonValue>()
  readonly client: ExtensionHostClient
  readonly context: ExtensionContext
  #deactivate?: Deactivate

  constructor(options: ExtensionTestHarnessOptions = {}) {
    this.identity =
      options.identity ??
      ({ id: 'test.extension', publisher: 'test', name: 'extension', version: '1.0.0' } as const)
    this.clock = options.clock ?? new FakeClock()
    this.transport = new FakeHostTransport({ permissions: options.permissions })
    this.permissions = this.transport.permissions
    this.agent = new FakeAgentService(this.transport, this.clock, this.identity)
    this.jobs = new FakeJobService(
      this.transport,
      this.clock,
      this.identity,
      options.workspace?.id ?? 'test-workspace'
    )
    this.media = new FakeMediaService(this.transport, this.jobs, this.clock)
    this.tools = new FakeToolService(this.transport)
    this.providers = new FakeProviderService(this.transport, this.clock)
    this.accounts = new FakeAccountService(this.clock)
    this.webview = new FakeWebviewService(
      this.identity,
      createHash('sha256').update(options.workspace?.id ?? '').digest('hex')
    )

    this.#installPermissionRules()
    this.#installServices()
    this.client = new ExtensionHostClient(this.transport)
    this.context = createExtensionContext(
      this.transport,
      {
        extension: this.identity,
        apiVersion: '1.2.0',
        capabilities: [
          'artifacts.generated',
          'jobs.observe',
          'media.brokered',
          'media.analysis',
          'media.archive',
          'media.documents'
        ],
        permissions: [...this.permissions],
        workspaceContext: options.workspace,
        activationEvent: 'onStartup'
      },
      this.client
    )
  }

  async activate(activate: Activate<ExtensionContext>, deactivate?: Deactivate): Promise<ExtensionContext> {
    this.#deactivate = deactivate
    await activate(this.context)
    return this.context
  }

  grant(...permissions: string[]): void {
    this.transport.grant(...permissions)
  }

  deny(...permissions: string[]): void {
    this.transport.deny(...permissions)
  }

  async dispose(): Promise<void> {
    await this.#deactivate?.()
    await this.context.subscriptions.dispose()
  }

  #installServices(): void {
    this.storage.install(this.transport)
    this.workspace.install(this.transport)
    this.agent.install()
    this.jobs.install()
    this.media.install()
    this.tools.install()
    this.providers.install()
    this.accounts.install(this.transport)
    this.webview.install(this.transport)
    this.transport.handle('configuration.get', (params) => {
      const input = JsonObjectSchema.parse(params)
      const key = `${String(input.sectionId)}/${String(input.key)}`
      const value = this.configuration.get(key)
      return value === undefined ? { found: false } : { found: true, value }
    })
    this.transport.handle('configuration.update', (params) => {
      const input = JsonObjectSchema.parse(params)
      const sectionId = String(input.sectionId)
      const key = String(input.key)
      const value = JsonValueSchema.parse(input.value)
      this.configuration.set(`${sectionId}/${key}`, value)
      this.transport.emit('configuration.changed', {
        sectionId,
        key,
        scope: 'workspace',
        value
      })
      return null
    })
    this.transport.handle('configuration.keys', (params) => {
      const sectionId = `${String(JsonObjectSchema.parse(params).sectionId)}/`
      return [...this.configuration.keys()]
        .filter((key) => key.startsWith(sectionId))
        .map((key) => key.slice(sectionId.length))
        .sort()
    })
    this.transport.handle('commands.register', (params) => ({
      registrationId: `command-${String(JsonObjectSchema.parse(params).id)}`
    }))
    this.transport.handle('commands.unregister', () => ({ ok: true }))
    this.transport.handle('commands.execute', (params) => {
      const parsed = JsonObjectSchema.parse(params)
      return this.transport.invokeExtension(`commands.invoke:command-${String(parsed.id)}`, parsed.args)
    })
    this.transport.handle('network.fetch', (params) => {
      const request = NetworkRequestSchema.parse(params)
      return NetworkResponseSchema.parse({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: request.url, method: request.method }),
        bodyEncoding: 'utf8',
        truncated: false
      })
    })
  }

  #installPermissionRules(): void {
    this.transport.requirePermission('commands.register', 'commands.register')
    this.transport.requirePermission('storage.get', storagePermission)
    this.transport.requirePermission('storage.set', storagePermission)
    this.transport.requirePermission('storage.delete', storagePermission)
    this.transport.requirePermission('storage.keys', storagePermission)
    this.transport.requirePermission('network.fetch', (params) => {
      const request = NetworkRequestSchema.parse(params)
      return `network:${new URL(request.url).hostname}`
    })
    for (const method of [
      'agent.createRun',
      'agent.getRun',
      'agent.subscribe',
      'agent.unsubscribe',
      'agent.steer',
      'agent.cancel'
    ]) {
      this.transport.requirePermission(method, 'agent.run')
    }
    this.transport.requirePermission('threads.listOwn', 'agent.threads.readOwn')
    this.transport.requirePermission('threads.getOwn', 'agent.threads.readOwn')
    this.transport.requirePermission('tools.register', 'tools.register')
    this.transport.requirePermission('modelProviders.register', 'providers.register')
    this.transport.requirePermission('authentication.listAccounts', 'accounts.read')
    this.transport.requirePermission('configuration.get', 'ui.actions')
    this.transport.requirePermission('configuration.update', 'ui.actions')
    this.transport.requirePermission('configuration.keys', 'ui.actions')
    this.transport.requirePermission('ui.showNotification', 'ui.notifications')
    this.transport.requirePermission('ui.attachComposerContext', 'ui.actions')
    this.transport.requirePermission('authentication.revealSecret', (params) => {
      const account = this.accounts.accounts.get(String(JsonObjectSchema.parse(params).accountId))
      return account ? `accounts.secrets.read:${account.providerId}` : 'accounts.read'
    })
    this.transport.requirePermission('workspace.readFile', 'workspace.read')
    this.transport.requirePermission('workspace.stat', 'workspace.read')
    this.transport.requirePermission('workspace.list', 'workspace.read')
    this.transport.requirePermission('workspace.writeFile', 'workspace.write')
    this.transport.requirePermission('media.pickFiles', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.pickSaveTarget', ['media.export', 'workspace.write'])
    this.transport.requirePermission('media.createCacheTarget', [
      'media.process',
      'workspace.write'
    ])
    this.transport.requirePermission('media.stat', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.readText', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.openViewResource', ['media.read', 'workspace.read'])
    this.transport.requirePermission('media.getCapabilities', 'media.process')
    this.transport.requirePermission('media.getAudioAnalysisCapabilities', 'media.process')
    for (const method of [
      'media.getVisualModelStatus',
      'media.installVisualModel',
      'media.embedVisualQuery'
    ]) this.transport.requirePermission(method, 'media.process')
    this.transport.requirePermission('media.analyzeVisualFrames', [
      'media.read', 'media.process', 'workspace.read'
    ])
    this.transport.requirePermission('media.probe', [
      'media.read',
      'media.process',
      'workspace.read'
    ])
    this.transport.requirePermission('media.startFfmpegJob', [
      'media.read',
      'media.process',
      'media.export',
      'jobs.manage',
      'workspace.read',
      'workspace.write'
    ])
    this.transport.requirePermission('media.startAudioAnalysisJob', [
      'media.read',
      'media.process',
      'jobs.manage',
      'workspace.read'
    ])
    this.transport.requirePermission('media.startArchiveJob', [
      'media.read',
      'media.export',
      'jobs.manage',
      'workspace.read',
      'workspace.write'
    ])
    for (const method of ['jobs.get', 'jobs.list', 'jobs.subscribe', 'jobs.unsubscribe', 'jobs.cancel']) {
      this.transport.requirePermission(method, 'jobs.manage')
    }
  }
}

function storagePermission(params: JsonValue | undefined): string {
  return JsonObjectSchema.parse(params).scope === 'global' ? 'storage.global' : 'storage.workspace'
}

function notFound(message: string, operation: string): ExtensionApiError {
  return new ExtensionApiError({
    code: 'NOT_FOUND',
    message,
    operation,
    retryable: false
  })
}

function isTerminal(state: AgentRun['state']): boolean {
  return ['completed', 'failed', 'cancelled', 'budget-exhausted'].includes(state)
}

function isTerminalJob(state: JobSnapshot['state']): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(state)
}

function unavailable(operation: string): ExtensionApiError {
  return new ExtensionApiError({
    code: 'HOST_UNAVAILABLE',
    message: 'Fake media executables are unavailable',
    operation,
    retryable: true
  })
}

export function createExtensionTestHarness(
  options: ExtensionTestHarnessOptions = {}
): ExtensionTestHarness {
  return new ExtensionTestHarness(options)
}
