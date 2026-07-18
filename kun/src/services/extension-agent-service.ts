import { resolve, relative, isAbsolute } from 'node:path'
import type { RuntimeEvent } from '../contracts/events.js'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ExtensionToolCatalogEpoch,
  ThreadRecord,
  ThreadSummary
} from '../contracts/threads.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadService } from './thread-service.js'
import { TurnConflictError, type TurnService } from './turn-service.js'
import type {
  ExtensionAgentProfileRegistry
} from './extension-agent-profile-registry.js'

export const EXTENSION_AGENT_PERMISSIONS = {
  run: 'agent.run',
  readOwnThreads: 'agent.threads.readOwn'
} as const

export type ExtensionPrincipal = Readonly<{
  extensionId: string
  extensionVersion: string
  permissions: readonly string[]
  workspaceRoots: readonly string[]
  workspaceTrusted: boolean
  /** Present only for a Node Extension Host and never accepted from a View. */
  hostLifecycleNonce?: string
  /** Present only for a sender-bound Webview principal. */
  viewSessionId?: string
  /** Present only for a sender-bound Webview principal. */
  viewContributionId?: string
}>

export type ExtensionAuthorizationRequest = Readonly<{
  operation: 'createRun' | 'getRun' | 'listOwn' | 'subscribe' | 'steer' | 'cancel'
  permission: string
  workspace?: string
  providerId?: string
  accountId?: string
  toolScopes?: readonly string[]
}>

export interface ExtensionAgentAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionAuthorizationRequest): Promise<void> | void
}

export type ExtensionAgentCreateRunRequest = {
  input: string
  threadId?: string
  workspace?: string
  profileId?: string
  providerBinding?: ExtensionProviderBinding
  budget?: Partial<ExtensionRunBudget>
  allowedTools?: string[]
  visibility?: ExtensionThreadVisibility
}

export type ExtensionAgentRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget-exhausted'

export type ExtensionAgentRun = {
  id: string
  threadId: string
  ownerExtensionId: string
  ownerExtensionVersion: string
  status: ExtensionAgentRunStatus
  createdAt: string
  finishedAt?: string
  workspace: string
  profile?: ExtensionAgentProfileSnapshot
  providerBinding: ExtensionProviderBinding
  effectiveBudget: ExtensionRunBudget
  visibility: ExtensionThreadVisibility
  toolCatalogEpoch?: ExtensionToolCatalogEpoch
  usage?: UsageSnapshot
  error?: string
}

export type ExtensionOwnedThread = {
  id: string
  title: string
  status: ThreadSummary['status']
  workspace: string
  model: string
  providerBinding: ExtensionProviderBinding
  ownerExtensionVersion: string
  profileId?: string
  visibility: ExtensionThreadVisibility
  createdAt: string
  updatedAt: string
  runCount: number
}

export type ExtensionAgentEvent = {
  seq: number
  timestamp: string
  type: RuntimeEvent['kind'] | 'subscription_overflow'
  runId: string
  threadId: string
  ownerExtensionId: string
  payload: Record<string, unknown>
}

export type ExtensionAgentSubscription = {
  readonly lastDeliveredSeq: number
  readonly closed: boolean
  close(): void
}

export type ExtensionAgentServiceOptions = {
  threads: ThreadService
  turns: TurnService
  sessions: SessionStore
  eventBus: EventBus
  profiles: ExtensionAgentProfileRegistry
  authorizer?: ExtensionAgentAuthorizer
  runTurn: (threadId: string, turnId: string) => Promise<unknown> | void
  defaultBinding: ExtensionProviderBinding
  defaultBudget?: Partial<ExtensionRunBudget>
  maximumBudget?: Partial<ExtensionRunBudget>
  headless?: boolean
  resolveToolCatalogEpoch?: (input: {
    principal: ExtensionPrincipal
    workspace: string
    allowedTools: readonly string[]
  }) => Promise<ExtensionToolCatalogEpoch | undefined>
}

const DEFAULT_BUDGET: ExtensionRunBudget = {
  maxTokens: 100_000,
  maxElapsedMs: 15 * 60_000,
  maxConcurrentRuns: 2,
  maxModelRequests: 64,
  maxToolInvocations: 128,
  maxRetainedEvents: 5_000
}

const MAXIMUM_BUDGET: ExtensionRunBudget = {
  maxTokens: 1_000_000,
  maxElapsedMs: 60 * 60_000,
  maxConcurrentRuns: 8,
  maxModelRequests: 512,
  maxToolInvocations: 1_024,
  maxRetainedEvents: 20_000
}

const MAX_LIST_LIMIT = 100
const MAX_SUBSCRIPTION_QUEUE = 256
const MAX_SUBSCRIPTION_QUEUE_BYTES = 512 * 1024
const MAX_EVENT_BYTES = 512 * 1024
const MAX_REPLAY_BYTES = 512 * 1024
const MAX_REPLAY_RECORD_BYTES = 4 * 1024 * 1024
const MAX_LIVE_EVENTS_DURING_REPLAY = 1_024
const MAX_LIVE_BYTES_DURING_REPLAY = 512 * 1024

type BufferedAgentEvent = {
  event: ExtensionAgentEvent
  bytes: number
}

/** Public Agent broker backed exclusively by the existing Kun runtime. */
export class ExtensionAgentService {
  private readonly runAdmissionQueues = new Map<string, Promise<void>>()
  private readonly authorizer: ExtensionAgentAuthorizer
  private readonly defaultBudget: ExtensionRunBudget
  private readonly maximumBudget: ExtensionRunBudget
  private defaultBinding: ExtensionProviderBinding

  constructor(private readonly options: ExtensionAgentServiceOptions) {
    this.authorizer = options.authorizer ?? new ManifestExtensionAgentAuthorizer()
    this.defaultBinding = { ...options.defaultBinding }
    this.defaultBudget = completeBudget(options.defaultBudget, DEFAULT_BUDGET)
    this.maximumBudget = completeBudget(options.maximumBudget, MAXIMUM_BUDGET)
  }

  updateRuntimeConfig(input: { defaultBinding: ExtensionProviderBinding }): void {
    validateBinding(input.defaultBinding)
    this.defaultBinding = { ...input.defaultBinding }
  }

  async createRun(
    principal: ExtensionPrincipal,
    request: ExtensionAgentCreateRunRequest
  ): Promise<ExtensionAgentRun> {
    return this.withRunAdmission(principal.extensionId, () => this.createRunAdmitted(principal, request))
  }

  private async createRunAdmitted(
    principal: ExtensionPrincipal,
    request: ExtensionAgentCreateRunRequest
  ): Promise<ExtensionAgentRun> {
    const input = request.input.trim()
    if (!input) throw new ExtensionBrokerError('validation_error', 'Agent input is required')
    if (input.length > 1_000_000) throw new ExtensionBrokerError('validation_error', 'Agent input is too large')

    if (request.threadId) {
      const thread = await this.ownedThread(principal, request.threadId)
      const workspace = normalizeOwnedWorkspace(principal, request.workspace ?? thread.workspace)
      if (resolve(workspace) !== resolve(thread.workspace)) {
        throw new ExtensionBrokerError('workspace_denied', 'Thread is outside the requested workspace scope')
      }
      await this.authorize(principal, {
        operation: 'createRun',
        permission: EXTENSION_AGENT_PERMISSIONS.run,
        workspace,
        ...(thread.providerId ? { providerId: thread.providerId } : {}),
        ...(thread.accountId ? { accountId: thread.accountId } : {})
      })
      if (thread.status === 'deleted' || thread.status === 'archived') {
        throw new ExtensionBrokerError('conflict', 'Owned thread is not available for a new run')
      }
      if (thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) {
        throw new ExtensionBrokerError('conflict', 'Owned thread already has an active run')
      }
      await this.assertConcurrentBudget(principal, thread.extensionBudget ?? this.defaultBudget)
      const tokenBaseline = await this.latestUsageTokens(thread.id)
      const started = await this.options.turns.startTurn({
        threadId: thread.id,
        request: {
          prompt: input,
          model: thread.model,
          ...(thread.providerId ? { providerId: thread.providerId } : {}),
          ...(thread.accountId ? { accountId: thread.accountId } : {}),
          ...(this.options.headless ? { disableUserInput: true } : {})
        }
      }, { extensionBudgetTokenBaseline: tokenBaseline })
      this.launch(thread.id, started.turnId)
      return this.projectRun(principal, thread.id, started.turnId)
    }

    const workspace = normalizeOwnedWorkspace(principal, request.workspace)
    let binding = request.providerBinding ?? this.defaultBinding
    let profile: ExtensionAgentProfileSnapshot | undefined
    let profileBudget: Partial<ExtensionRunBudget> | undefined
    let profileVisibility: ExtensionThreadVisibility = 'private'
    if (request.profileId) {
      const resolvedProfile = this.options.profiles.resolve({
        extensionId: principal.extensionId,
        profileId: request.profileId,
        fallbackBinding: binding
      })
      profile = resolvedProfile.snapshot
      profileBudget = resolvedProfile.defaultBudget
      profileVisibility = resolvedProfile.visibility
      if (!request.providerBinding) binding = resolvedProfile.providerBinding
    }
    validateBinding(binding)

    const allowedTools = narrowToolScopes(profile?.allowedToolScopes ?? [], request.allowedTools)
    await this.authorize(principal, {
      operation: 'createRun',
      permission: EXTENSION_AGENT_PERMISSIONS.run,
      workspace,
      providerId: binding.providerId,
      ...(binding.accountId ? { accountId: binding.accountId } : {}),
      ...(allowedTools.length ? { toolScopes: allowedTools } : {})
    })
    const effectiveBudget = clampBudget(
      { ...this.defaultBudget, ...profileBudget, ...request.budget },
      this.maximumBudget
    )
    await this.assertConcurrentBudget(principal, effectiveBudget)
    const visibility = request.visibility === 'workspace' && profileVisibility === 'workspace'
      ? 'workspace'
      : 'private'
    const resolvedProfile: ExtensionAgentProfileSnapshot = profile
      ? {
          ...profile,
          model: binding.modelId,
          providerId: binding.providerId,
          ...(binding.accountId ? { accountId: binding.accountId } : {}),
          allowedToolScopes: allowedTools
        }
      : {
          id: 'default',
          instructionDigest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          model: binding.modelId,
          providerId: binding.providerId,
          ...(binding.accountId ? { accountId: binding.accountId } : {}),
          allowedToolScopes: allowedTools
        }
    const toolCatalogEpoch = await this.options.resolveToolCatalogEpoch?.({
      principal,
      workspace,
      allowedTools
    })
    const thread = await this.options.threads.create({
      title: titleFromInput(input),
      workspace,
      model: binding.modelId,
      providerId: binding.providerId,
      mode: 'agent'
    }, {
      extensionMetadata: {
        ownerExtensionId: principal.extensionId,
        ownerExtensionVersion: principal.extensionVersion,
        ...(binding.accountId ? { accountId: binding.accountId } : {}),
        extensionVisibility: visibility,
        extensionProfile: resolvedProfile,
        extensionBudget: effectiveBudget,
        ...(toolCatalogEpoch ? { toolCatalogEpoch } : {})
      }
    })
    const started = await this.options.turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: input,
        model: binding.modelId,
        providerId: binding.providerId,
        ...(binding.accountId ? { accountId: binding.accountId } : {}),
        ...(this.options.headless ? { disableUserInput: true } : {})
      }
    }, { extensionBudgetTokenBaseline: 0 })
    this.launch(thread.id, started.turnId)
    return this.projectRun(principal, thread.id, started.turnId)
  }

  async getRun(principal: ExtensionPrincipal, runId: string): Promise<ExtensionAgentRun> {
    const { thread } = await this.findOwnedRun(principal, runId)
    await this.authorize(principal, {
      operation: 'getRun',
      permission: EXTENSION_AGENT_PERMISSIONS.readOwnThreads,
      workspace: thread.workspace
    })
    return this.projectRun(principal, thread.id, runId)
  }

  async getOwnThread(principal: ExtensionPrincipal, threadId: string): Promise<ExtensionOwnedThread> {
    const thread = await this.ownedThread(principal, threadId)
    await this.authorize(principal, {
      operation: 'getRun',
      permission: EXTENSION_AGENT_PERMISSIONS.readOwnThreads,
      workspace: thread.workspace
    })
    return projectThread(thread)
  }

  async listOwnThreads(
    principal: ExtensionPrincipal,
    input: { limit?: number; cursor?: string; workspace?: string } = {}
  ): Promise<{ items: ExtensionOwnedThread[]; nextCursor?: string }> {
    await this.authorize(principal, {
      operation: 'listOwn',
      permission: EXTENSION_AGENT_PERMISSIONS.readOwnThreads,
      ...(input.workspace ? { workspace: normalizeOwnedWorkspace(principal, input.workspace) } : {})
    })
    const all = (await this.options.threads.list({ includeArchived: true, includeSide: true }))
      .filter((thread) => thread.ownerExtensionId === principal.extensionId)
      .filter((thread) => !input.workspace || resolve(thread.workspace) === resolve(input.workspace))
    const offset = decodeCursor(input.cursor)
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(input.limit ?? 25)))
    const page = all.slice(offset, offset + limit)
    const items = (await Promise.all(page.map((summary) => this.options.threads.get(summary.id))))
      .filter((thread): thread is ThreadRecord => Boolean(thread))
      .map(projectThread)
    return {
      items,
      ...(offset + items.length < all.length ? { nextCursor: encodeCursor(offset + items.length) } : {})
    }
  }

  async steer(principal: ExtensionPrincipal, runId: string, text: string): Promise<void> {
    const value = text.trim()
    if (!value || value.length > 100_000) {
      throw new ExtensionBrokerError('validation_error', 'Steering text is empty or too large')
    }
    const { thread } = await this.findOwnedRun(principal, runId)
    await this.authorize(principal, {
      operation: 'steer', permission: EXTENSION_AGENT_PERMISSIONS.run, workspace: thread.workspace
    })
    try {
      await this.options.turns.steerTurn({ threadId: thread.id, turnId: runId, text: value })
    } catch (error) {
      if (error instanceof TurnConflictError) throw new ExtensionBrokerError('conflict', error.message)
      throw error
    }
  }

  async cancel(principal: ExtensionPrincipal, runId: string): Promise<ExtensionAgentRun> {
    const { thread, turn } = await this.findOwnedRun(principal, runId)
    await this.authorize(principal, {
      operation: 'cancel', permission: EXTENSION_AGENT_PERMISSIONS.run, workspace: thread.workspace
    })
    if (turn.status === 'queued' || turn.status === 'running') {
      await this.options.turns.interruptTurn({ threadId: thread.id, turnId: runId })
    }
    return this.projectRun(principal, thread.id, runId)
  }

  async subscribe(
    principal: ExtensionPrincipal,
    input: { runId: string; afterSeq?: number },
    listener: (event: ExtensionAgentEvent) => Promise<void> | void
  ): Promise<ExtensionAgentSubscription> {
    const { thread } = await this.findOwnedRun(principal, input.runId)
    await this.authorize(principal, {
      operation: 'subscribe',
      permission: EXTENSION_AGENT_PERMISSIONS.run,
      workspace: thread.workspace
    })
    const afterSeq = input.afterSeq ?? 0
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new ExtensionBrokerError('validation_error', 'afterSeq must be a non-negative safe integer')
    }
    const state = new ManagedSubscription(listener, afterSeq)
    let replaying = true
    const live: BufferedAgentEvent[] = []
    const liveSeqs = new Set<number>()
    let liveBytes = 0
    const unsubscribe = this.options.eventBus.subscribe(thread.id, (event) => {
      if (state.closed || state.overflowed || event.turnId !== input.runId || event.seq <= afterSeq) return
      const projected = projectEvent(principal, input.runId, event)
      if (!replaying) {
        state.enqueue(projected)
        return
      }
      if (liveSeqs.has(projected.seq)) return
      const bytes = serializedEventBytes(projected)
      if (
        bytes > MAX_EVENT_BYTES ||
        liveSeqs.size >= MAX_LIVE_EVENTS_DURING_REPLAY ||
        liveBytes + bytes > MAX_LIVE_BYTES_DURING_REPLAY
      ) {
        state.overflow(projected, 'extension subscription live replay buffer overflowed')
        return
      }
      live.push({ event: projected, bytes })
      liveSeqs.add(projected.seq)
      liveBytes += bytes
    })
    state.setUnsubscribe(unsubscribe)
    try {
      const replayLimit = thread.extensionBudget?.maxRetainedEvents ?? this.defaultBudget.maxRetainedEvents
      const replay: Array<BufferedAgentEvent | undefined> = []
      const replaySeqs = new Set<number>()
      let replayBytes = 0
      let replayStart = 0
      for await (const event of iterateSessionEventsSince(this.options.sessions, thread.id, afterSeq)) {
        if (state.closed || state.overflowed) break
        if (event.turnId !== input.runId || replaySeqs.has(event.seq)) continue
        const projected = projectEvent(principal, input.runId, event)
        const bytes = serializedEventBytes(projected)
        if (bytes > MAX_EVENT_BYTES) {
          state.overflow(projected, 'persisted extension subscription event exceeds the message limit')
          break
        }
        replay.push({ event: projected, bytes })
        replaySeqs.add(projected.seq)
        replayBytes += bytes
        while (replay.length - replayStart > replayLimit || replayBytes > MAX_REPLAY_BYTES) {
          const removed = replay[replayStart]
          if (!removed) break
          replay[replayStart] = undefined
          replayStart += 1
          replaySeqs.delete(removed.event.seq)
          replayBytes -= removed.bytes
        }
        if (replayStart >= 1_024 && replayStart * 2 >= replay.length) {
          replay.splice(0, replayStart)
          replayStart = 0
        }
      }
      if (!state.closed && !state.overflowed) {
        const retainedReplay = replay
          .slice(replayStart)
          .filter((entry): entry is BufferedAgentEvent => entry !== undefined)
          .sort(compareBufferedEvents)
        for (const entry of retainedReplay) {
          state.enqueue(entry.event, entry.bytes)
          await state.flush()
          if (state.closed || state.overflowed) break
        }
      }
      while (!state.closed && !state.overflowed && live.length > 0) {
        const batch = live.splice(0).sort(compareBufferedEvents)
        for (const entry of batch) {
          liveSeqs.delete(entry.event.seq)
          liveBytes -= entry.bytes
          state.enqueue(entry.event, entry.bytes)
          await state.flush()
          if (state.closed || state.overflowed) break
        }
      }
      replaying = false
      await state.flush()
      return state
    } catch (error) {
      state.close()
      throw error
    }
  }

  private async projectRun(
    principal: ExtensionPrincipal,
    threadId: string,
    runId: string
  ): Promise<ExtensionAgentRun> {
    const thread = await this.ownedThread(principal, threadId)
    const turn = thread.turns.find((candidate) => candidate.id === runId)
    if (!turn) throw opaqueNotFound()
    const { usage, budgetExhausted } = await summarizeRunEvents(
      this.options.sessions,
      threadId,
      runId
    )
    return {
      id: runId,
      threadId,
      ownerExtensionId: principal.extensionId,
      ownerExtensionVersion: thread.ownerExtensionVersion ?? principal.extensionVersion,
      status: budgetExhausted ? 'budget-exhausted' : runStatus(turn.status),
      createdAt: turn.createdAt,
      ...(turn.finishedAt ? { finishedAt: turn.finishedAt } : {}),
      workspace: thread.workspace,
      ...(thread.extensionProfile ? { profile: structuredClone(thread.extensionProfile) } : {}),
      providerBinding: {
        providerId: thread.providerId ?? this.defaultBinding.providerId,
        ...(thread.accountId ? { accountId: thread.accountId } : {}),
        modelId: turn.model ?? thread.model
      },
      effectiveBudget: thread.extensionBudget ?? this.defaultBudget,
      visibility: thread.extensionVisibility ?? 'private',
      ...(thread.toolCatalogEpoch ? { toolCatalogEpoch: structuredClone(thread.toolCatalogEpoch) } : {}),
      ...(usage ? { usage } : {}),
      ...(turn.error ? { error: turn.error } : {})
    }
  }

  private async findOwnedRun(principal: ExtensionPrincipal, runId: string) {
    const threads = await this.options.threads.list({ includeArchived: true, includeSide: true })
    // Avoid leaking whether a foreign run exists: only fetch candidate owned threads.
    for (const candidate of threads) {
      if (candidate.ownerExtensionId !== principal.extensionId) continue
      const thread = await this.options.threads.get(candidate.id)
      const turn = thread?.turns.find((entry) => entry.id === runId)
      if (thread && turn) return { thread, turn }
    }
    throw opaqueNotFound()
  }

  private async ownedThread(principal: ExtensionPrincipal, threadId: string): Promise<ThreadRecord> {
    const thread = await this.options.threads.get(threadId)
    if (!thread || thread.ownerExtensionId !== principal.extensionId) throw opaqueNotFound()
    return thread
  }

  private async authorize(principal: ExtensionPrincipal, request: ExtensionAuthorizationRequest): Promise<void> {
    try {
      await this.authorizer.authorize(principal, request)
    } catch (error) {
      if (error instanceof ExtensionBrokerError) throw error
      throw new ExtensionBrokerError('permission_denied', error instanceof Error ? error.message : 'Permission denied')
    }
  }

  private launch(threadId: string, turnId: string): void {
    void Promise.resolve(this.options.runTurn(threadId, turnId)).catch(() => undefined)
  }

  private async withRunAdmission<T>(extensionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runAdmissionQueues.get(extensionId) ?? Promise.resolve()
    let release!: () => void
    const lock = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.catch(() => undefined).then(() => lock)
    this.runAdmissionQueues.set(extensionId, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.runAdmissionQueues.get(extensionId) === tail) {
        this.runAdmissionQueues.delete(extensionId)
      }
    }
  }

  private async assertConcurrentBudget(
    principal: ExtensionPrincipal,
    budget: ExtensionRunBudget
  ): Promise<void> {
    const summaries = await this.options.threads.list({ includeArchived: true, includeSide: true })
    let active = 0
    for (const summary of summaries) {
      if (summary.ownerExtensionId !== principal.extensionId) continue
      const thread = await this.options.threads.get(summary.id)
      if (thread?.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) active += 1
    }
    if (active >= budget.maxConcurrentRuns) {
      throw new ExtensionBrokerError(
        'conflict',
        `Extension concurrent run budget exhausted (${active}/${budget.maxConcurrentRuns})`
      )
    }
  }

  private async latestUsageTokens(threadId: string): Promise<number> {
    if (this.options.sessions.loadLatestUsageSnapshots) {
      const snapshots = await this.options.sessions.loadLatestUsageSnapshots({ threadIds: [threadId] })
      const snapshot = snapshots.find((candidate) => candidate.threadId === threadId)
      if (snapshot) return snapshot.usage.totalTokens
    }
    let totalTokens = 0
    for await (const event of iterateSessionEventsSince(this.options.sessions, threadId, 0)) {
      if (event.kind === 'usage') totalTokens = event.usage.totalTokens
    }
    return totalTokens
  }
}

export class ManifestExtensionAgentAuthorizer implements ExtensionAgentAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionAuthorizationRequest): void {
    if (!principal.workspaceTrusted && request.workspace) {
      throw new ExtensionBrokerError('workspace_denied', 'Workspace is not trusted for this extension')
    }
    if (!principal.permissions.includes(request.permission)) {
      throw new ExtensionBrokerError('permission_denied', `Missing permission: ${request.permission}`)
    }
    if (request.workspace) normalizeOwnedWorkspace(principal, request.workspace)
    if (request.accountId && request.providerId) {
      const accountPermission = `accounts.use:${request.providerId}`
      if (!principal.permissions.includes(accountPermission)) {
        throw new ExtensionBrokerError('permission_denied', `Missing permission: ${accountPermission}`)
      }
    }
  }
}

export class ExtensionBrokerError extends Error {
  constructor(
    readonly code: 'validation_error' | 'permission_denied' | 'workspace_denied' | 'not_found' | 'conflict',
    message: string
  ) {
    super(message)
    this.name = 'ExtensionBrokerError'
  }
}

async function* iterateSessionEventsSince(
  sessions: SessionStore,
  threadId: string,
  afterSeq: number
): AsyncIterable<RuntimeEvent> {
  if (!sessions.iterateEventsSince) {
    throw new ExtensionBrokerError(
      'conflict',
      'Bounded extension event replay is unavailable for this session store.'
    )
  }
  yield* sessions.iterateEventsSince(threadId, afterSeq, { maxRecordBytes: MAX_REPLAY_RECORD_BYTES })
}

async function summarizeRunEvents(
  sessions: SessionStore,
  threadId: string,
  runId: string
): Promise<{ usage?: UsageSnapshot; budgetExhausted: boolean }> {
  let baseline: UsageSnapshot | undefined
  let cumulativeUsage: UsageSnapshot | undefined
  const runUsageMetadata: RunUsageMetadata = {}
  let budgetExhausted = false
  let reachedRun = false
  for await (const event of iterateSessionEventsSince(sessions, threadId, 0)) {
    if (event.turnId !== runId) {
      if (!reachedRun && event.kind === 'usage') baseline = event.usage
      continue
    }
    reachedRun = true
    if (event.kind === 'usage') {
      cumulativeUsage = event.usage
      mergeRunUsageMetadata(runUsageMetadata, event.usage)
    }
    if (
      event.kind === 'error' &&
      /budget|limit/i.test(`${event.code ?? ''} ${event.message ?? ''}`)
    ) {
      budgetExhausted = true
    }
  }
  const usage = cumulativeUsage
    ? subtractCumulativeUsage(cumulativeUsage, baseline, runUsageMetadata)
    : undefined
  return { ...(usage ? { usage } : {}), budgetExhausted }
}

type RunUsageMetadata = Pick<
  UsageSnapshot,
  | 'cacheableTokenHitRate'
  | 'totalInputTokenHitRate'
  | 'cacheMissReasons'
  | 'cacheSuggestions'
  | 'hasError'
>

function mergeRunUsageMetadata(target: RunUsageMetadata, usage: UsageSnapshot): void {
  if (usage.cacheableTokenHitRate !== undefined) {
    target.cacheableTokenHitRate = usage.cacheableTokenHitRate
  }
  if (usage.totalInputTokenHitRate !== undefined) {
    target.totalInputTokenHitRate = usage.totalInputTokenHitRate
  }
  if (usage.cacheMissReasons !== undefined) {
    target.cacheMissReasons = unionStrings(target.cacheMissReasons, usage.cacheMissReasons)
  }
  if (usage.cacheSuggestions !== undefined) {
    target.cacheSuggestions = unionStrings(target.cacheSuggestions, usage.cacheSuggestions)
  }
  if (usage.hasError) target.hasError = true
}

function unionStrings(left: string[] | undefined, right: string[]): string[] {
  return [...new Set([...(left ?? []), ...right])]
}

/** Project one run from thread-cumulative counters without losing cost/cache provenance. */
function subtractCumulativeUsage(
  current: UsageSnapshot,
  baseline: UsageSnapshot | undefined,
  runMetadata: RunUsageMetadata
): UsageSnapshot {
  const subtract = (value: number, prior: number | undefined) => Math.max(0, value - (prior ?? 0))
  const optional = (value: number | undefined, prior: number | undefined) =>
    value === undefined ? undefined : subtract(value, prior)
  const promptTokens = subtract(current.promptTokens, baseline?.promptTokens)
  const completionTokens = subtract(current.completionTokens, baseline?.completionTokens)
  const cacheHitTokens = optional(current.cacheHitTokens, baseline?.cacheHitTokens)
  const cacheMissTokens = optional(current.cacheMissTokens, baseline?.cacheMissTokens)
  const cacheTelemetryTotal = (cacheHitTokens ?? 0) + (cacheMissTokens ?? 0)
  const costByCurrency = current.costByCurrency
    ? Object.fromEntries(Object.entries(current.costByCurrency).map(([currency, cost]) => [
        currency,
        subtract(cost, baseline?.costByCurrency?.[currency])
      ]))
    : undefined
  const cacheableTokenHitRate = cacheTelemetryTotal > 0
    ? (cacheHitTokens ?? 0) / cacheTelemetryTotal
    : runMetadata.cacheableTokenHitRate
  const totalInputTokenHitRate = cacheTelemetryTotal > 0
    ? promptTokens > 0
      ? Math.min(1, (cacheHitTokens ?? 0) / promptTokens)
      : 0
    : runMetadata.totalInputTokenHitRate
  return {
    promptTokens,
    completionTokens,
    ...(current.reasoningTokens !== undefined
      ? { reasoningTokens: subtract(current.reasoningTokens, baseline?.reasoningTokens) }
      : {}),
    totalTokens: subtract(current.totalTokens, baseline?.totalTokens),
    ...(current.cachedTokens !== undefined
      ? { cachedTokens: subtract(current.cachedTokens, baseline?.cachedTokens) }
      : {}),
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
    ...(current.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: subtract(current.cacheWriteTokens, baseline?.cacheWriteTokens) }
      : {}),
    cacheHitRate: cacheTelemetryTotal > 0 ? (cacheHitTokens ?? 0) / cacheTelemetryTotal : null,
    ...(cacheableTokenHitRate !== undefined ? { cacheableTokenHitRate } : {}),
    ...(totalInputTokenHitRate !== undefined ? { totalInputTokenHitRate } : {}),
    ...(runMetadata.cacheMissReasons !== undefined
      ? { cacheMissReasons: runMetadata.cacheMissReasons }
      : {}),
    ...(runMetadata.cacheSuggestions !== undefined
      ? { cacheSuggestions: runMetadata.cacheSuggestions }
      : {}),
    turns: subtract(current.turns, baseline?.turns),
    ...(current.costUsd !== undefined
      ? { costUsd: subtract(current.costUsd, baseline?.costUsd) }
      : {}),
    ...(current.costCny !== undefined
      ? { costCny: subtract(current.costCny, baseline?.costCny) }
      : {}),
    ...(costByCurrency ? { costByCurrency } : {}),
    ...(current.cacheSavingsUsd !== undefined
      ? { cacheSavingsUsd: subtract(current.cacheSavingsUsd, baseline?.cacheSavingsUsd) }
      : {}),
    ...(current.cacheSavingsCny !== undefined
      ? { cacheSavingsCny: subtract(current.cacheSavingsCny, baseline?.cacheSavingsCny) }
      : {}),
    ...(current.tokenEconomySavingsTokens !== undefined
      ? {
          tokenEconomySavingsTokens: subtract(
            current.tokenEconomySavingsTokens,
            baseline?.tokenEconomySavingsTokens
          )
        }
      : {}),
    ...(current.tokenEconomySavingsUsd !== undefined
      ? {
          tokenEconomySavingsUsd: subtract(
            current.tokenEconomySavingsUsd,
            baseline?.tokenEconomySavingsUsd
          )
        }
      : {}),
    ...(current.tokenEconomySavingsCny !== undefined
      ? {
          tokenEconomySavingsCny: subtract(
            current.tokenEconomySavingsCny,
            baseline?.tokenEconomySavingsCny
          )
        }
      : {}),
    ...(runMetadata.hasError ? { hasError: true } : {})
  }
}

function compareBufferedEvents(left: BufferedAgentEvent, right: BufferedAgentEvent): number {
  return left.event.seq - right.event.seq
}

function serializedEventBytes(event: ExtensionAgentEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

class ManagedSubscription implements ExtensionAgentSubscription {
  private queue: BufferedAgentEvent[] = []
  private queueBytes = 0
  private pendingOverflow?: { source: ExtensionAgentEvent; message: string }
  private overflowRequested = false
  private currentDrain?: Promise<void>
  private unsubscribe?: () => void
  closed = false
  lastDeliveredSeq: number

  constructor(
    private readonly listener: (event: ExtensionAgentEvent) => Promise<void> | void,
    initialSeq: number
  ) {
    this.lastDeliveredSeq = initialSeq
  }

  get overflowed(): boolean {
    return this.overflowRequested
  }

  setUnsubscribe(unsubscribe: () => void): void {
    this.unsubscribe = unsubscribe
    if (this.closed) unsubscribe()
  }

  enqueue(event: ExtensionAgentEvent, knownBytes?: number): void {
    if (this.closed || event.seq <= this.lastDeliveredSeq) return
    if (this.pendingOverflow || this.queue.some((queued) => queued.event.seq === event.seq)) return
    const bytes = knownBytes ?? serializedEventBytes(event)
    if (bytes > MAX_EVENT_BYTES) {
      this.overflow(event, 'event exceeds the extension subscription message limit')
      return
    }
    if (
      this.queue.length >= MAX_SUBSCRIPTION_QUEUE ||
      this.queueBytes + bytes > MAX_SUBSCRIPTION_QUEUE_BYTES
    ) {
      this.overflow(event, 'extension subscription queue overflowed')
      return
    }
    this.queue.push({ event, bytes })
    this.queueBytes += bytes
    this.queue.sort(compareBufferedEvents)
    void this.startDrain()
  }

  overflow(source: ExtensionAgentEvent, message: string): void {
    if (this.closed || this.overflowRequested) return
    this.queue = []
    this.queueBytes = 0
    this.overflowRequested = true
    this.pendingOverflow = { source, message }
    void this.startDrain()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue = []
    this.queueBytes = 0
    this.pendingOverflow = undefined
    this.unsubscribe?.()
  }

  async flush(): Promise<void> {
    while (this.currentDrain || this.queue.length > 0 || this.pendingOverflow) {
      await this.startDrain()
    }
  }

  private startDrain(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.currentDrain) return this.currentDrain
    const drain = this.drain().finally(() => {
      if (this.currentDrain === drain) this.currentDrain = undefined
      if (!this.closed && (this.queue.length > 0 || this.pendingOverflow)) void this.startDrain()
    })
    this.currentDrain = drain
    return drain
  }

  private async drain(): Promise<void> {
    try {
      while (!this.closed) {
        const overflow = this.pendingOverflow
        if (overflow) {
          this.pendingOverflow = undefined
          await this.listener({
            ...overflow.source,
            type: 'subscription_overflow',
            payload: { message: overflow.message, resumeAfterSeq: this.lastDeliveredSeq }
          })
          this.close()
          break
        }
        const entry = this.queue.shift()
        if (!entry) break
        this.queueBytes -= entry.bytes
        if (entry.event.seq <= this.lastDeliveredSeq) continue
        await this.listener(entry.event)
        this.lastDeliveredSeq = entry.event.seq
      }
    } catch {
      this.close()
    }
  }
}

function projectThread(thread: ThreadRecord): ExtensionOwnedThread {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    workspace: thread.workspace,
    model: thread.model,
    providerBinding: {
      providerId: thread.providerId ?? 'default',
      ...(thread.accountId ? { accountId: thread.accountId } : {}),
      modelId: thread.model
    },
    ownerExtensionVersion: thread.ownerExtensionVersion ?? 'unknown',
    ...(thread.extensionProfile?.id ? { profileId: thread.extensionProfile.id } : {}),
    visibility: thread.extensionVisibility ?? 'private',
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    runCount: thread.turns.length
  }
}

function projectEvent(
  principal: ExtensionPrincipal,
  runId: string,
  event: RuntimeEvent
): ExtensionAgentEvent {
  const { seq, timestamp, kind, threadId, turnId: _turnId, ...raw } = event
  return {
    seq,
    timestamp,
    type: kind,
    runId,
    threadId,
    ownerExtensionId: principal.extensionId,
    payload: redactProtectedFields(raw as Record<string, unknown>)
  }
}

function redactProtectedFields(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = JSON.parse(JSON.stringify(value, (key, current) => {
    if (/^(approvalId|inputId|consentToken|runtimeToken|apiKey|accessToken|refreshToken|clientSecret|authorization|cookie)$/i.test(key)) {
      return undefined
    }
    return current
  })) as Record<string, unknown>
  return redacted
}

function runStatus(status: ThreadRecord['turns'][number]['status']): ExtensionAgentRunStatus {
  switch (status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'aborted': return 'cancelled'
    default: return 'running'
  }
}

function validateBinding(binding: ExtensionProviderBinding): void {
  if (!binding.providerId.trim() || !binding.modelId.trim()) {
    throw new ExtensionBrokerError('validation_error', 'Provider binding requires providerId and modelId')
  }
  if (binding.accountId !== undefined && !binding.accountId.trim()) {
    throw new ExtensionBrokerError('validation_error', 'Provider binding accountId cannot be empty')
  }
}

function normalizeOwnedWorkspace(principal: ExtensionPrincipal, requested?: string): string {
  const roots = principal.workspaceRoots.map((root) => resolve(root))
  if (roots.length === 0) throw new ExtensionBrokerError('workspace_denied', 'Extension has no workspace grant')
  const workspace = resolve(requested ?? roots[0]!)
  const owned = roots.some((root) => {
    const child = relative(root, workspace)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!owned) throw new ExtensionBrokerError('workspace_denied', 'Workspace is outside the extension grant')
  return workspace
}

function completeBudget(
  partial: Partial<ExtensionRunBudget> | undefined,
  fallback: ExtensionRunBudget
): ExtensionRunBudget {
  return clampBudget({ ...fallback, ...partial }, MAXIMUM_BUDGET)
}

function clampBudget(
  requested: Partial<ExtensionRunBudget>,
  maximum: ExtensionRunBudget
): ExtensionRunBudget {
  const out = {} as ExtensionRunBudget
  for (const key of Object.keys(DEFAULT_BUDGET) as Array<keyof ExtensionRunBudget>) {
    const value = requested[key] ?? DEFAULT_BUDGET[key]
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ExtensionBrokerError('validation_error', `Invalid extension run budget: ${key}`)
    }
    out[key] = Math.min(value, maximum[key])
  }
  return out
}

function narrowToolScopes(profileScopes: readonly string[], requested: readonly string[] | undefined): string[] {
  const profile = [...new Set(profileScopes.map((value) => value.trim()).filter(Boolean))].sort()
  if (!requested) return profile
  const wanted = [...new Set(requested.map((value) => value.trim()).filter(Boolean))]
  if (profile.length === 0) return wanted.sort()
  const allowed = new Set(profile)
  for (const tool of wanted) {
    if (!allowed.has(tool)) {
      throw new ExtensionBrokerError('permission_denied', `Tool is outside the profile scope: ${tool}`)
    }
  }
  return wanted.sort()
}

function titleFromInput(input: string): string {
  const line = input.split(/\r?\n/, 1)[0]?.trim() || 'Extension run'
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    if (Number.isSafeInteger(value.offset) && Number(value.offset) >= 0) return Number(value.offset)
  } catch {
    // Stable validation error below.
  }
  throw new ExtensionBrokerError('validation_error', 'Invalid thread cursor')
}

function opaqueNotFound(): ExtensionBrokerError {
  return new ExtensionBrokerError('not_found', 'Extension-owned resource was not found')
}
