import type {
  AttachmentMetadata,
  GraphOrchestrationStrategy,
  GraphRunV1,
  ThreadGoalStatus,
  ThreadSummary,
  ThreadTodoItem,
  ThreadTodoStatus
} from '../contracts/index.js'
import {
  kunToolPermissionModeFromSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { ModelReasoningEffort, ModelReasoningCapabilityMetadata } from '../contracts/capabilities.js'
import { redactSecretText } from '../config/secret-redaction.js'
import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename as renameFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { UserInputAnswer } from './client.js'
import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import {
  KunTuiClient,
  TuiClientError,
  type TuiConnection
} from './client.js'
import type { TuiOptions } from './options.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  setProjectionRunningTurn,
  type ThreadProjection
} from './state.js'
import {
  emptyTuiPersistentState,
  modelStateKey,
  readTuiPersistentState,
  writeTuiPersistentState,
  type TuiPersistentState,
  type TuiRecentModel
} from './persistence.js'
import { modelCapabilitiesForProviderModel } from '../loop/model-context-profile.js'
import { setVisualTheme, type TuiThemeName } from './visual-system.js'
import {
  KunProjectConfigSchema,
  loadKunProjectConfig,
  writeKunProjectConfig
} from '../config/project-config.js'
import { readRuntimeDiscovery } from '../server/runtime-discovery.js'
import { parsePastedFilePaths } from './pasted-paths.js'
import type { ClipboardImage } from './clipboard-image.js'
import {
  isTerminalGraphRun,
  latestTuiGraphRun,
  summarizeTuiGraphRun
} from './graph-mode.js'
import { parseTuiFileMentions } from './file-mentions.js'
const execFile = promisify(execFileCallback)
import { safeMessage, modelConnectionUnavailableMessage, isRefreshConflict, isMissingThread, replaceGraphRun, splitWords, extensionGrantArguments, todoInput, resolveTodo, attachmentIdsFromProjection, mergeAttachmentMetadata, attachmentMimeType, isLikelyUtf8Text, isVideoPath, formatBytes, normalizeSkillId, skillTemplate, assertPathMissing, writeTextAtomically, isPathInside, validateSkillImportTree } from './controller-utils.js'

export type ControllerView = 'threads' | 'chat' | 'help'
export type ControllerConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export type TuiControllerState = {
  view: ControllerView
  threads: ThreadSummary[]
  threadSearch: string
  selectedThreadIndex: number
  threadListMode: 'active' | 'archived'
  projection?: ThreadProjection
  connection: ControllerConnectionState
  busy: boolean
  busyLabel?: string
  busyStartedAt?: string
  notification?: { kind: 'info' | 'error'; message: string }
  inspection?: { title: string; lines: string[] }
  modelConnections?: ModelConnectionSnapshot
  reasoningEffort?: ModelReasoningEffort
  composerMode: 'agent' | 'plan'
  composerOrchestration: GraphOrchestrationStrategy
  graphAvailable?: boolean
  graphUnavailableReason?: string
  graphRuns: GraphRunV1[]
  graphBoard?: { runId: string }
  pendingAttachments: AttachmentMetadata[]
  attachmentMetadata: Record<string, AttachmentMetadata>
  theme: TuiThemeName
  quitRequested: boolean
}

export abstract class TuiControllerBase {
  protected stateValue: TuiControllerState = {
    // A bare `kun` starts on the guided composer. The conversation picker is
    // an explicit Ctrl+T action; opening it automatically leaves first-time
    // users staring at an empty modal with no explanation of what to do.
    view: 'chat',
    threads: [],
    threadSearch: '',
    selectedThreadIndex: 0,
    threadListMode: 'active',
    connection: 'connecting',
    busy: false,
    composerMode: 'agent',
    composerOrchestration: 'direct',
    graphRuns: [],
    pendingAttachments: [],
    attachmentMetadata: {},
    theme: 'kun',
    quitRequested: false
  }
  protected readonly listeners = new Set<(state: TuiControllerState) => void>()
  protected eventsAbort?: AbortController
  protected activeSubscription?: Promise<void>
  protected modelEventsAbort?: AbortController
  protected modelEventsSubscription?: Promise<void>
  protected persisted: TuiPersistentState = emptyTuiPersistentState()
  protected persistenceInitialization?: Promise<void>
  protected persistenceWrite: Promise<void> = Promise.resolve()
  protected readonly redoTargets = new Map<string, string>()
  protected readonly locallyEnabledCapabilities = new Set<'attachments' | 'memory'>()
  protected readonly attachmentMetadataRequests = new Set<string>()
  protected readonly graphRunRequests = new Set<string>()
  protected readonly graphRunRefreshPending = new Set<string>()
  protected attachmentHydrationGeneration = 0
  protected readonly attachmentLeaseId = `tui_${randomUUID()}`
  /**
   * CLI overrides apply to newly created sessions only. `options` also holds
   * the active session selection for rendering and turn submission, so keep a
   * separate immutable copy before registry or thread hydration updates it.
   */
  protected readonly newThreadSelectionOverride: {
    providerId?: string
    accountId?: string
    model?: string
  }

  constructor(
    readonly client: KunTuiClient,
    readonly options: TuiOptions,
    readonly runtime: TuiConnection,
    private readonly onModelSelectionChanged?: (
      snapshot: ModelConnectionSnapshot
    ) => Promise<void> | void
  ) {
    this.newThreadSelectionOverride = {
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(options.accountId ? { accountId: options.accountId } : {}),
      ...(options.model ? { model: options.model } : {})
    }
  }

  get state(): TuiControllerState {
    return this.stateValue
  }

  applyModelSelection(snapshot: ModelConnectionSnapshot, notify = true): void {
    const configurationChanged = this.stateValue.modelConnections?.revision !== snapshot.revision
    const activeSession = this.stateValue.projection
    if (snapshot.defaultModel) this.runtime.runtimeInfo.model = snapshot.defaultModel
    else if (!activeSession) this.runtime.runtimeInfo.model = ''
    if (!activeSession) this.applySharedDefaultToActiveSelection(snapshot)
    const reasoningEffort = activeSession
      ? this.resolveReasoningEffort({
          snapshot,
          providerId: this.options.providerId ?? activeSession.thread.providerId,
          accountId: this.options.accountId ?? activeSession.thread.accountId,
          model: this.options.model ?? activeSession.thread.model,
          ...(this.stateValue.reasoningEffort ? { preferred: this.stateValue.reasoningEffort } : {})
        })
      : this.resolveReasoningEffort({
          snapshot,
          providerId: this.options.providerId,
          accountId: this.options.accountId,
          model: this.options.model,
          ...(this.stateValue.reasoningEffort ? { preferred: this.stateValue.reasoningEffort } : {})
        })
    this.patch({ modelConnections: snapshot, reasoningEffort })
    if (configurationChanged && snapshot.defaultProviderId && snapshot.defaultAccountId && snapshot.defaultModel) {
      void this.recordRecentModel({
        providerId: snapshot.defaultProviderId,
        accountId: snapshot.defaultAccountId,
        model: snapshot.defaultModel
      })
    }
    if (configurationChanged && this.onModelSelectionChanged) {
      void Promise.resolve(this.onModelSelectionChanged(snapshot)).catch((error) => {
        this.notify(`Could not persist the shared default model: ${safeMessage(error)}`, 'error')
      })
    }
    if (notify && configurationChanged) this.notify(
      snapshot.defaultProviderId && snapshot.defaultModel
        ? `${this.runtime.legacyGui ? 'Shared model' : 'Default model'}: ${snapshot.defaultProviderId}/${snapshot.defaultModel}`
        : 'Model connection updated.'
    )
  }

  async initializeModelConnections(): Promise<ModelConnectionSnapshot> {
    await this.initializePersistence()
    const snapshot = await this.client.modelConnections()
    this.applyModelSelection(snapshot, false)
    return snapshot
  }

  watchModelConnections(initialSnapshot = this.stateValue.modelConnections): void {
    if (this.modelEventsSubscription) return
    const abort = new AbortController()
    this.modelEventsAbort = abort
    const subscription = (async () => {
      const initial = initialSnapshot ?? await this.client.modelConnections()
      if (abort.signal.aborted) return
      if (!initialSnapshot) this.applyModelSelection(initial, false)
      await this.client.subscribeModelConnections({
        sinceRevision: initial.revision,
        sinceMetadataRevision: initial.metadataRevision ?? 0,
        signal: abort.signal,
        onSnapshot: (snapshot) => this.applyModelSelection(snapshot),
        onError: (error) => this.notify(safeMessage(error), 'error')
      })
    })()
    this.modelEventsSubscription = subscription
    void subscription.catch((error) => {
      if (!abort.signal.aborted) this.notify(safeMessage(error), 'error')
    }).finally(() => {
      if (this.modelEventsAbort === abort) {
        this.modelEventsAbort = undefined
        this.modelEventsSubscription = undefined
      }
    })
  }

  subscribe(listener: (state: TuiControllerState) => void): () => void {
    this.listeners.add(listener)
    listener(this.stateValue)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    await this.initializePersistence()
    await this.refreshGraphAvailability(false)
    await this.refreshThreads()
    if (this.options.threadId) {
      await this.openThread(this.options.threadId)
    } else if (this.options.continueLatest && this.stateValue.threads[0]) {
      await this.openThread(this.stateValue.threads[0].id)
    }
  }

  async stop(): Promise<void> {
    this.eventsAbort?.abort()
    this.modelEventsAbort?.abort()
    const releasePendingAttachments = Promise.all(
      this.stateValue.pendingAttachments.map((attachment) =>
        this.releasePendingAttachment(attachment))
    )
    const closeModelConnections = typeof this.client.closeModelConnections === 'function'
      ? this.client.closeModelConnections().catch(() => undefined)
      : Promise.resolve()
    await Promise.all([
      this.activeSubscription?.catch(() => undefined),
      this.modelEventsSubscription?.catch(() => undefined),
      this.persistenceWrite.catch(() => undefined),
      releasePendingAttachments,
      closeModelConnections
    ])
  }

  abstract refreshThreads(search?: string, mode?: 'active' | 'archived'): Promise<void>
  abstract openThread(threadId: string): Promise<void>
  abstract inspect(title: string, lines: string[]): void

  showThreads(search = '', mode: 'active' | 'archived' = 'active'): void {
    this.patch({ view: 'threads', threadListMode: mode, selectedThreadIndex: 0 })
    void this.refreshThreads(search, mode)
  }

  async resumeLatest(search = ''): Promise<void> {
    if (search.trim()) {
      this.showThreads(search, 'active')
      return
    }
    await this.refreshThreads('', 'active')
    const latest = this.stateValue.threads[0]
    if (latest) await this.openThread(latest.id)
    else this.notify('No saved session is available. Start typing to create one.', 'error')
  }

  showHelp(): void {
    this.patch({ view: 'help' })
  }

  showChat(): void {
    this.patch({ view: 'chat' })
  }

  requestQuit(): void {
    this.patch({ quitRequested: true })
  }

  notify(message: string, kind: 'info' | 'error' = 'info'): void {
    this.patch({ notification: { kind, message } })
  }

  protected async refreshGraphAvailability(notify: boolean): Promise<boolean> {
    if (typeof this.client.graphAvailability !== 'function') {
      const reason = 'The connected Kun runtime does not support TUI Graph mode.'
      this.patch({
        graphAvailable: false,
        graphUnavailableReason: reason,
        composerOrchestration: 'direct'
      })
      if (notify) this.notify(reason, 'error')
      return false
    }
    try {
      const availability = await this.client.graphAvailability()
      const reason = availability.enabled
        ? undefined
        : 'Graph Mode is disabled in the shared Kun runtime configuration.'
      this.patch({
        graphAvailable: availability.enabled,
        graphUnavailableReason: reason,
        ...(!availability.enabled ? { composerOrchestration: 'direct' as const } : {})
      })
      if (notify && reason) this.notify(reason, 'error')
      return availability.enabled
    } catch (error) {
      const reason = error instanceof TuiClientError && error.status === 404
        ? 'The connected Kun runtime does not support TUI Graph mode.'
        : `Graph Mode availability could not be verified: ${safeMessage(error)}`
      this.patch({
        graphAvailable: false,
        graphUnavailableReason: reason,
        composerOrchestration: 'direct'
      })
      if (notify) this.notify(reason, 'error')
      return false
    }
  }

  protected async reconcileGraphRun(runId: string, threadId: string): Promise<void> {
    if (typeof this.client.getGraphRun !== 'function') return
    if (this.graphRunRequests.has(runId)) {
      this.graphRunRefreshPending.add(runId)
      return
    }
    this.graphRunRequests.add(runId)
    try {
      do {
        this.graphRunRefreshPending.delete(runId)
        const run = await this.client.getGraphRun(runId)
        if (
          this.stateValue.projection?.thread.id !== threadId ||
          run.threadId !== threadId
        ) return
        this.patch({ graphRuns: replaceGraphRun(this.stateValue.graphRuns, run) })
      } while (this.graphRunRefreshPending.has(runId))
    } catch (error) {
      if (this.stateValue.projection?.thread.id === threadId) {
        this.notify(`Graph progress refresh failed: ${safeMessage(error)}`, 'error')
      }
    } finally {
      this.graphRunRequests.delete(runId)
      this.graphRunRefreshPending.delete(runId)
    }
  }

  protected async reloadActiveThread(): Promise<void> {
    const id = this.stateValue.projection?.thread.id
    if (id) await this.openThread(id)
  }

  protected async refreshActiveThread(error: unknown): Promise<void> {
    this.patch({ notification: { kind: 'error', message: safeMessage(error) }, busy: false })
    await this.reloadActiveThread()
  }

  protected requireProjection(): ThreadProjection | undefined {
    const projection = this.stateValue.projection
    if (!projection) this.notify('Open or create a session first.', 'error')
    return projection
  }

  protected reasoningCapability(input: {
    snapshot?: ModelConnectionSnapshot
    providerId?: string
    accountId?: string
    model?: string
  } = {}): ModelReasoningCapabilityMetadata | undefined {
    const snapshot = input.snapshot ?? this.stateValue.modelConnections
    const providerId = input.providerId ?? this.options.providerId ?? snapshot?.defaultProviderId
    const model = input.model ?? this.options.model ?? this.stateValue.projection?.thread.model ?? snapshot?.defaultModel
    if (!model) return undefined
    const profile = snapshot?.providers.find((entry) =>
      (entry.id === providerId && (!input.accountId || entry.accountId === input.accountId)) ||
      (!providerId && entry.models.includes(model))
    )
    const effective = profile?.modelCapabilities?.[model]
    const derived = effective?.reasoning
    // Versioned Runtime metadata already resolved user overrides and account constraints.
    // Only unversioned legacy snapshots may need the old compatibility fallback.
    if (effective?.metadata || effective?.supportsReasoning === false) {
      return effective.supportsReasoning === false ? undefined : derived
    }
    const builtIn = modelCapabilitiesForProviderModel({
      providerId: profile?.id ?? providerId,
      presetSource: profile?.presetSource,
      baseUrl: profile?.baseUrl,
      endpointFormat: profile?.endpointFormat, endpoints: profile?.endpoints,
      kind: profile?.kind,
      model
    }).reasoning
    if (derived) {
      if (
        builtIn &&
        (
          (
            profile?.endpointFormat === 'chat_completions' &&
            derived.requestProtocol === 'openai-responses' &&
            builtIn.requestProtocol === 'openai-chat-completions' &&
            (
              (
                profile.id.toLowerCase().includes('kimi-code') &&
                model.trim().toLowerCase() === 'k3'
              ) ||
              (
                profile.id.toLowerCase().includes('opencode-go') &&
                model.trim().toLowerCase().endsWith('grok-4.5')
              )
            )
          ) ||
          (
            builtIn.requestProtocol !== 'none' &&
            derived.requestProtocol === 'none' &&
            derived.defaultEffort === 'auto' &&
            derived.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
          )
        )
      ) {
        return builtIn
      }
      return derived
    }
    const runtimeCapability = this.runtime.runtimeInfo.capabilities?.model
    const runtimeReasoning = runtimeCapability?.id === model
      ? runtimeCapability.reasoning
      : undefined
    if (runtimeReasoning) return runtimeReasoning
    // Older GUI runtimes and early registry snapshots did not publish
    // per-model capabilities. Fall back only to Kun's audited built-in model
    // profiles; unknown/custom model ids still resolve without reasoning.
    return builtIn
  }

  protected resolveReasoningEffort(input: {
    snapshot?: ModelConnectionSnapshot
    providerId?: string
    accountId?: string
    model?: string
    preferred?: ModelReasoningEffort
  }): ModelReasoningEffort | undefined {
    const capability = this.reasoningCapability(input)
    if (!capability) return input.preferred
    if (input.preferred && capability.supportedEfforts.includes(input.preferred)) return input.preferred
    const providerId = input.providerId ?? this.options.providerId
    const accountId = input.accountId ?? this.options.accountId
    const model = input.model ?? this.options.model
    if (providerId && accountId && model) {
      const remembered = this.persisted.reasoningByModel[modelStateKey(providerId, accountId, model)]
      if (remembered && capability.supportedEfforts.includes(remembered)) return remembered
    }
    return capability.defaultEffort
  }

  protected rememberReasoningEffort(effort: ModelReasoningEffort): void {
    const providerId = this.options.providerId
    const accountId = this.options.accountId
    const model = this.options.model
    if (!providerId || !accountId || !model) return
    const key = modelStateKey(providerId, accountId, model)
    this.persisted = {
      ...this.persisted,
      reasoningByModel: { ...this.persisted.reasoningByModel, [key]: effort }
    }
    void this.savePersistentState()
  }

  protected async recordRecentModel(entry: TuiRecentModel): Promise<void> {
    const key = modelStateKey(entry.providerId, entry.accountId, entry.model)
    this.persisted = {
      ...this.persisted,
      recentModels: [
        entry,
        ...this.persisted.recentModels.filter((candidate) =>
          modelStateKey(candidate.providerId, candidate.accountId, candidate.model) !== key
        )
      ].slice(0, 20)
    }
    await this.savePersistentState()
  }

  protected async savePersistentState(): Promise<void> {
    const snapshot = this.persisted
    const write = this.persistenceWrite.catch(() => undefined).then(async () => {
      await writeTuiPersistentState(this.options.dataDir, snapshot)
    }).catch((error) => {
      this.notify(`Could not save TUI state: ${safeMessage(error)}`, 'error')
    })
    this.persistenceWrite = write
    await write
  }

  protected initializePersistence(): Promise<void> {
    this.persistenceInitialization ??= (async () => {
      this.persisted = await readTuiPersistentState(this.options.dataDir)
      this.redoTargets.clear()
      for (const [branchId, sourceId] of Object.entries(this.persisted.redoTargets)) {
        this.redoTargets.set(branchId, sourceId)
      }
      setVisualTheme(this.persisted.theme)
      this.patch({ theme: this.persisted.theme })
    })()
    return this.persistenceInitialization
  }

  protected newThreadSelection(snapshot = this.stateValue.modelConnections): {
    providerId?: string
    accountId?: string
    model?: string
  } {
    const override = this.newThreadSelectionOverride
    let providerId = override.providerId ?? snapshot?.defaultProviderId
    let accountId = override.accountId ??
      (providerId === snapshot?.defaultProviderId ? snapshot?.defaultAccountId : undefined)
    let profile = snapshot?.providers.find((entry) =>
      entry.id === providerId && (!accountId || entry.accountId === accountId)
    )

    if (!override.providerId && override.model && profile && !profile.models.includes(override.model)) {
      profile = snapshot?.providers.find((entry) =>
        entry.models.includes(override.model!) &&
        (!override.accountId || entry.accountId === override.accountId)
      )
      providerId = profile?.id ?? providerId
      accountId = override.accountId ?? profile?.accountId ?? accountId
    }

    const model = override.model ??
      (providerId === snapshot?.defaultProviderId ? snapshot?.defaultModel : undefined) ??
      profile?.selectedModel ??
      profile?.models[0]
    const resolvedAccountId = accountId ?? profile?.accountId
    return {
      ...(providerId ? { providerId } : {}),
      ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
      ...(model ? { model } : {})
    }
  }

  protected applySharedDefaultToActiveSelection(snapshot: ModelConnectionSnapshot): void {
    const selection = this.newThreadSelection(snapshot)
    this.options.providerId = selection.providerId
    this.options.accountId = selection.accountId
    this.options.model = selection.model
  }

  protected async ensureLocalCapability(id: 'attachments' | 'memory'): Promise<void> {
    if (this.locallyEnabledCapabilities.has(id) || this.runtime.runtimeInfo.capabilities[id].available) return
    await this.client.setLocalCapabilityEnabled(id, true)
    this.locallyEnabledCapabilities.add(id)
  }

  protected async uploadLocalAttachment(candidate: string, workspace: string): Promise<AttachmentMetadata> {
    await this.ensureLocalCapability('attachments')
    const canonical = await realpath(candidate)
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw new Error('attachment path must be a regular file')
    if (metadata.size > 10 * 1024 * 1024) throw new Error('attachment exceeds the 10 MiB upload limit')
    const data = await readFile(canonical)
    const mimeType = attachmentMimeType(canonical, data)
    if (mimeType === 'application/octet-stream') {
      throw new Error(`unsupported attachment type: ${basename(canonical)}`)
    }
    const response = await this.client.uploadAttachment({
      name: basename(canonical),
      mimeType,
      dataBase64: data.toString('base64'),
      localFilePath: canonical,
      leaseId: this.attachmentLeaseId,
      ...(this.stateValue.projection?.thread.id
        ? { threadId: this.stateValue.projection.thread.id }
        : {}),
      workspace
    })
    return response.attachment
  }

  protected async uploadMemoryAttachment(
    name: string,
    mimeType: ClipboardImage['mimeType'],
    data: Buffer,
    workspace: string
  ): Promise<AttachmentMetadata> {
    await this.ensureLocalCapability('attachments')
    const response = await this.client.uploadAttachment({
      name,
      mimeType,
      dataBase64: data.toString('base64'),
      leaseId: this.attachmentLeaseId,
      ...(this.stateValue.projection?.thread.id
        ? { threadId: this.stateValue.projection.thread.id }
        : {}),
      workspace
    })
    return response.attachment
  }

  protected async releasePendingAttachment(attachment: AttachmentMetadata): Promise<void> {
    if (typeof this.client.releaseAttachment !== 'function') return
    await this.client.releaseAttachment(attachment.id, this.attachmentLeaseId).catch(() => undefined)
  }

  protected fail(error: unknown): void {
    this.patch({ busy: false, notification: { kind: 'error', message: safeMessage(error) } })
  }

  protected patch(patch: Partial<TuiControllerState>): void {
    const normalized = { ...patch }
    if (patch.busy === true) {
      const busyLabel = patch.busyLabel ?? this.stateValue.busyLabel ?? 'Working'
      const phaseChanged = !this.stateValue.busy || busyLabel !== this.stateValue.busyLabel
      normalized.busyLabel = busyLabel
      normalized.busyStartedAt = phaseChanged
        ? new Date().toISOString()
        : this.stateValue.busyStartedAt ?? new Date().toISOString()
    } else if (patch.busy === false) {
      normalized.busyLabel = undefined
      normalized.busyStartedAt = undefined
    }
    this.stateValue = { ...this.stateValue, ...normalized }
    for (const listener of this.listeners) listener(this.stateValue)
  }
}
