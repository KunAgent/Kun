import { resolve } from 'node:path'
import type {
  ExtensionAgentProfileSnapshot,
  ExtensionRunBudget,
  ExtensionThreadVisibility,
  ThreadRecord
} from '../contracts/threads.js'
import type { ExtensionProviderBinding } from '../contracts/extension-providers.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import { TurnConflictError } from './turn-service.js'
import { bufferEvent, compareBufferedEvents, enqueueBufferedEvent, ExtensionBrokerError, iterateSessionEventsSince, loadLatestUsageTokens, ManifestExtensionAgentAuthorizer, summarizeRunEvents } from './extension-agent-service-event-usage.js'
import { listExtensionRunEvents, pageExtensionOwnedThreads } from './extension-agent-service-listing.js'
import { ManagedSubscription } from './extension-agent-service-subscription.js'
import { clampBudget, completeBudget, decodeCursor, narrowToolScopes, normalizeOwnedWorkspace, opaqueNotFound, projectThread, runStatus, titleFromInput, validateBinding } from './extension-agent-service-projection.js'
import {
  DEFAULT_BUDGET,
  EXTENSION_AGENT_PERMISSIONS,
  MAXIMUM_BUDGET,
  MAX_EVENT_BYTES,
  MAX_LIST_LIMIT,
  MAX_LIVE_BYTES_DURING_REPLAY,
  MAX_LIVE_EVENTS_DURING_REPLAY,
  MAX_REPLAY_BYTES,
  type BufferedAgentEvent,
  type ExtensionAgentCreateRunRequest,
  type ExtensionAgentAuthorizer,
  type ExtensionAgentEvent,
  type ExtensionAgentEventPage,
  type ExtensionAgentModelOption,
  type ExtensionAgentRun,
  type ExtensionAgentRunOptions,
  type ExtensionAgentRunStatus,
  type ExtensionAgentRuntimeConfig,
  type ExtensionAgentServiceOptions,
  type ExtensionAgentSubscription,
  type ExtensionAuthorizationRequest,
  type ExtensionOwnedThread,
  type ExtensionPrincipal
} from './extension-agent-service-contracts.js'

export { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_BYTES, MAX_HISTORY_LIMIT } from './extension-agent-service-listing.js'
export * from './extension-agent-service-contracts.js'

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

  stageRuntimeConfig(input: ExtensionAgentRuntimeConfig): ExtensionAgentRuntimeConfig {
    validateBinding(input.defaultBinding)
    return { defaultBinding: { ...input.defaultBinding } }
  }

  publishRuntimeConfig(input: ExtensionAgentRuntimeConfig): void {
    this.defaultBinding = { ...input.defaultBinding }
  }

  updateRuntimeConfig(input: ExtensionAgentRuntimeConfig): void {
    this.publishRuntimeConfig(this.stageRuntimeConfig(input))
  }

  async getRunOptions(principal: ExtensionPrincipal): Promise<ExtensionAgentRunOptions> {
    await this.authorize(principal, {
      operation: 'getRunOptions',
      permission: EXTENSION_AGENT_PERMISSIONS.run
    })
    return this.currentRunOptions()
  }

  private currentRunOptions(): ExtensionAgentRunOptions {
    const resolved = this.options.resolveRunOptions?.() ?? {
      defaultModel: this.defaultBinding.modelId,
      models: [{
        id: this.defaultBinding.modelId,
        displayName: this.defaultBinding.modelId,
        selected: true,
        reasoningEfforts: []
      }]
    }
    const defaultModel = resolved.defaultModel.trim()
    if (!defaultModel || defaultModel.length > 512) {
      throw new ExtensionBrokerError('conflict', 'Kun model selection is unavailable')
    }
    const byId = new Map<string, ExtensionAgentModelOption>()
    for (const option of resolved.models) {
      const id = option.id.trim()
      if (!id || id.length > 512 || byId.has(id)) continue
      const reasoningEfforts = [...new Set(option.reasoningEfforts)]
      byId.set(id, {
        id,
        displayName: option.displayName.trim().slice(0, 512) || id,
        selected: id === defaultModel,
        reasoningEfforts,
        ...(option.defaultReasoningEffort && reasoningEfforts.includes(option.defaultReasoningEffort)
          ? { defaultReasoningEffort: option.defaultReasoningEffort }
          : {})
      })
    }
    if (!byId.has(defaultModel)) {
      byId.set(defaultModel, {
        id: defaultModel,
        displayName: defaultModel,
        selected: true,
        reasoningEfforts: []
      })
    }
    return { defaultModel, models: [...byId.values()] }
  }

  private resolveRunSelection(
    request: Pick<ExtensionAgentCreateRunRequest, 'model' | 'reasoningEffort'>,
    fallbackModel: string,
    requireAvailable = false
  ): { model: string; reasoningEffort?: ModelReasoningEffort } {
    const options = this.currentRunOptions()
    const model = request.model?.trim() || fallbackModel.trim()
    const option = options.models.find((candidate) => candidate.id === model)
    if (!option && (request.model || requireAvailable)) {
      throw new ExtensionBrokerError(
        request.model ? 'validation_error' : 'conflict',
        request.model
          ? 'Requested model is not available'
          : 'The thread model is no longer available on the active Kun connection'
      )
    }
    if (request.reasoningEffort && !option?.reasoningEfforts.includes(request.reasoningEffort)) {
      throw new ExtensionBrokerError(
        'validation_error',
        'Requested reasoning effort is not supported by this model'
      )
    }
    return {
      model,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {})
    }
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
    if ((request.model || request.reasoningEffort) && request.providerBinding) {
      throw new ExtensionBrokerError(
        'validation_error',
        'Host model selection cannot be combined with an extension provider binding'
      )
    }

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
      const usesHostConnection =
        (thread.providerId ?? this.defaultBinding.providerId) === this.defaultBinding.providerId &&
        !thread.accountId
      if ((request.model || request.reasoningEffort) && !usesHostConnection) {
        throw new ExtensionBrokerError(
          'validation_error',
          'Host model selection is available only for the active Kun model connection'
        )
      }
      const selection = this.resolveRunSelection(
        request,
        thread.turns.at(-1)?.model ?? thread.model,
        usesHostConnection
      )
      const tokenBaseline = await loadLatestUsageTokens(this.options.sessions, thread.id)
      const started = await this.options.turns.startTurn({
        threadId: thread.id,
        request: {
          prompt: input,
          clientSurface: 'extension',
          model: selection.model,
          ...(thread.providerId ? { providerId: thread.providerId } : {}),
          ...(thread.accountId ? { accountId: thread.accountId } : {}),
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
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

    const usesHostConnection = binding.providerId === this.defaultBinding.providerId && !binding.accountId
    if ((request.model || request.reasoningEffort) && !usesHostConnection) {
      throw new ExtensionBrokerError(
        'validation_error',
        'Host model selection is available only for the active Kun model connection'
      )
    }
    const selection = this.resolveRunSelection(request, binding.modelId, usesHostConnection)
    if (request.model) {
      binding = { ...binding, modelId: selection.model }
    }

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
        clientSurface: 'extension',
        model: binding.modelId,
        providerId: binding.providerId,
        ...(binding.accountId ? { accountId: binding.accountId } : {}),
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
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

  async listRunEvents(
    principal: ExtensionPrincipal,
    input: { runId: string; afterSequence?: number; limit?: number }
  ): Promise<ExtensionAgentEventPage> {
    const { thread } = await this.findOwnedRun(principal, input.runId)
    for (const permission of [EXTENSION_AGENT_PERMISSIONS.run, EXTENSION_AGENT_PERMISSIONS.readOwnThreads]) {
      await this.authorize(principal, { operation: 'listRunEvents', permission, workspace: thread.workspace })
    }
    return listExtensionRunEvents({
      sessions: this.options.sessions,
      principal,
      threadId: thread.id,
      runId: input.runId,
      afterSequence: input.afterSequence,
      limit: input.limit
    })
  }

  async getOwnThread(principal: ExtensionPrincipal, threadId: string): Promise<ExtensionOwnedThread> {
    const thread = await this.ownedThread(principal, threadId)
    await this.authorize(principal, {
      operation: 'getRun',
      permission: EXTENSION_AGENT_PERMISSIONS.readOwnThreads,
      workspace: thread.workspace
    })
    return this.projectOwnedThread(principal, thread)
  }

  async listOwnThreads(
    principal: ExtensionPrincipal,
    input: {
      limit?: number
      cursor?: string
      workspace?: string
      state?: ExtensionAgentRunStatus | 'queued' | 'waiting-approval' | 'waiting-user-input'
    } = {}
  ): Promise<{ items: ExtensionOwnedThread[]; nextCursor?: string }> {
    await this.authorize(principal, {
      operation: 'listOwn',
      permission: EXTENSION_AGENT_PERMISSIONS.readOwnThreads,
      ...(input.workspace ? { workspace: normalizeOwnedWorkspace(principal, input.workspace) } : {})
    })
    const candidates = (await this.options.threads.list({ includeArchived: true, includeSide: true }))
      .filter((thread) => thread.ownerExtensionId === principal.extensionId)
      .filter((thread) => !input.workspace || resolve(thread.workspace) === resolve(input.workspace))
    const offset = decodeCursor(input.cursor)
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(input.limit ?? 25)))
    return pageExtensionOwnedThreads({
      candidates,
      sessions: this.options.sessions,
      offset,
      limit,
      state: input.state,
      loadThread: (threadId) => this.options.threads.get(threadId),
      projectThread: (thread, latestSummary) => this.projectOwnedThread(principal, thread, latestSummary)
    })
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
    if (!Number.isSafeInteger(afterSeq) || afterSeq < -1) {
      throw new ExtensionBrokerError('validation_error', 'afterSeq must be a safe integer greater than or equal to -1')
    }
    const state = new ManagedSubscription(listener, afterSeq, {
      runId: input.runId,
      threadId: thread.id,
      ownerExtensionId: principal.extensionId
    })
    let replaying = true
    const live: BufferedAgentEvent[] = []
    const liveSeqs = new Set<number>()
    let liveBytes = 0
    const unsubscribe = this.options.eventBus.subscribe(thread.id, (event) => {
      if (state.closed || state.overflowed || event.turnId !== input.runId || event.seq <= afterSeq) return
      const buffered = bufferEvent(principal, input.runId, event)
      if (!replaying) {
        enqueueBufferedEvent(state, buffered)
        return
      }
      if (liveSeqs.has(buffered.seq)) return
      const bytes = buffered.bytes
      if (
        bytes > MAX_EVENT_BYTES ||
        liveSeqs.size >= MAX_LIVE_EVENTS_DURING_REPLAY ||
        liveBytes + bytes > MAX_LIVE_BYTES_DURING_REPLAY
      ) {
        state.overflowBuffered(buffered, 'extension subscription live replay buffer overflowed')
        return
      }
      live.push(buffered)
      liveSeqs.add(buffered.seq)
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
        const buffered = bufferEvent(principal, input.runId, event)
        const bytes = buffered.bytes
        if (bytes > MAX_EVENT_BYTES) {
          state.overflowBuffered(buffered, 'persisted extension subscription event exceeds the message limit')
          break
        }
        replay.push(buffered)
        replaySeqs.add(buffered.seq)
        replayBytes += bytes
        while (replay.length - replayStart > replayLimit || replayBytes > MAX_REPLAY_BYTES) {
          const removed = replay[replayStart]
          if (!removed) break
          replay[replayStart] = undefined
          replayStart += 1
          replaySeqs.delete(removed.seq)
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
          enqueueBufferedEvent(state, entry)
          await state.flush()
          if (state.closed || state.overflowed) break
        }
      }
      while (!state.closed && !state.overflowed && live.length > 0) {
        const batch = live.splice(0).sort(compareBufferedEvents)
        for (const entry of batch) {
          liveSeqs.delete(entry.seq)
          liveBytes -= entry.bytes
          enqueueBufferedEvent(state, entry)
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
    return this.projectRunFromThread(principal, thread, runId)
  }

  private async projectRunFromThread(
    principal: ExtensionPrincipal,
    thread: ThreadRecord,
    runId: string,
    knownSummary?: Awaited<ReturnType<typeof summarizeRunEvents>>
  ): Promise<ExtensionAgentRun> {
    const turn = thread.turns.find((candidate) => candidate.id === runId)
    if (!turn) throw opaqueNotFound()
    const { usage, budgetExhausted, waitingState } = knownSummary ?? await summarizeRunEvents(
      this.options.sessions,
      thread.id,
      runId
    )
    return {
      id: runId,
      threadId: thread.id,
      ownerExtensionId: principal.extensionId,
      ownerExtensionVersion: thread.ownerExtensionVersion ?? principal.extensionVersion,
      status: budgetExhausted ? 'budget-exhausted' : waitingState ?? runStatus(turn.status),
      createdAt: turn.createdAt,
      ...(turn.finishedAt ? { finishedAt: turn.finishedAt } : {}),
      workspace: thread.workspace,
      ...(thread.extensionProfile ? { profile: structuredClone(thread.extensionProfile) } : {}),
      providerBinding: {
        providerId: thread.providerId ?? this.defaultBinding.providerId,
        ...(thread.accountId ? { accountId: thread.accountId } : {}),
        modelId: turn.model ?? thread.model
      },
      ...(turn.reasoningEffort ? { reasoningEffort: turn.reasoningEffort } : {}),
      effectiveBudget: thread.extensionBudget ?? this.defaultBudget,
      visibility: thread.extensionVisibility ?? 'private',
      ...(thread.toolCatalogEpoch ? { toolCatalogEpoch: structuredClone(thread.toolCatalogEpoch) } : {}),
      ...(usage ? { usage } : {}),
      ...(turn.error ? { error: turn.error } : {})
    }
  }

  private async projectOwnedThread(
    principal: ExtensionPrincipal,
    thread: ThreadRecord,
    latestSummary?: Awaited<ReturnType<typeof summarizeRunEvents>>
  ): Promise<ExtensionOwnedThread> {
    const latestTurn = thread.turns.at(-1)
    return projectThread(
      thread,
      latestTurn
        ? await this.projectRunFromThread(principal, thread, latestTurn.id, latestSummary)
        : undefined
    )
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

}
