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
import { TuiControllerTurns } from './controller-turns.js'

export abstract class TuiControllerModes extends TuiControllerTurns {
  async setPermissions(
    approvalPolicy: ApprovalPolicy,
    sandboxMode: SandboxMode,
    approvalReviewer: ApprovalReviewer
  ): Promise<boolean> {
    const projection = this.requireProjection()
    if (!projection) return false
    try {
      const thread = await this.client.updateThread(projection.thread.id, {
        approvalPolicy,
        sandboxMode,
        approvalReviewer
      })
      const mode = kunToolPermissionModeFromSettings({
        approvalPolicy,
        sandboxMode,
        approvalReviewer
      })
      this.patch({
        projection: { ...projection, thread: { ...projection.thread, ...thread } },
        notification: { kind: 'info', message: `Permissions: ${mode}` }
      })
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async setPlanMode(mode: 'agent' | 'plan'): Promise<void> {
    const projection = this.stateValue.projection
    if (!projection) {
      this.patch({ composerMode: mode, composerOrchestration: 'direct' })
      this.notify(`New session mode: ${mode}`)
      return
    }
    try {
      if (projection.thread.goal?.status === 'active') {
        await this.client.setThreadGoal(projection.thread.id, { status: 'paused' })
      }
      const thread = await this.client.updateThread(projection.thread.id, { mode })
      this.patch({
        projection: { ...projection, thread: { ...projection.thread, ...thread } },
        composerMode: mode,
        composerOrchestration: 'direct',
        notification: {
          kind: 'info',
          message: projection.thread.goal?.status === 'active'
            ? `Goal paused · session mode: ${mode}`
            : `Session mode: ${mode}`
        }
      })
    } catch (error) {
      this.fail(error)
    }
  }

  async manageGraphMode(action?: string): Promise<boolean> {
    const requested = action?.trim().toLowerCase() ?? ''
    if (requested === 'status' || requested === 'list') {
      await this.showGraphStatus()
      return true
    }
    if (requested === 'off' || requested === 'direct' || requested === 'agent') {
      this.patch({ composerOrchestration: 'direct' })
      this.notify('Graph mode off · subsequent turns use Direct orchestration.')
      return true
    }
    if (requested && requested !== 'on' && requested !== 'start') {
      this.notify('Usage: /graph [status|off|requirement]', 'error')
      return false
    }
    if (!await this.refreshGraphAvailability(false)) {
      this.patch({ composerOrchestration: 'direct' })
      this.notify(
        this.stateValue.graphUnavailableReason ??
          'Graph Mode is disabled in the shared Kun runtime.',
        'error'
      )
      return false
    }
    const current = this.stateValue.projection
    if (
      current &&
      (current.thread.mode !== 'agent' || current.thread.goal?.status === 'active')
    ) {
      await this.setPlanMode('agent')
    } else {
      this.patch({ composerMode: 'agent', composerOrchestration: 'direct' })
    }
    const active = this.stateValue.projection
    if (active && (
      active.thread.mode !== 'agent' ||
      active.thread.goal?.status === 'active'
    )) return false
    this.patch({
      composerMode: 'agent',
      composerOrchestration: 'graph',
      notification: {
        kind: 'info',
        message: 'Graph mode active · type a requirement and press Enter.'
      }
    })
    return true
  }

  async submitGraphRequirement(prompt: string): Promise<boolean> {
    const requirement = prompt.trim()
    if (!requirement) return false
    if (!await this.manageGraphMode('on')) return false
    await this.submit(requirement)
    return true
  }

  async showGraphStatus(): Promise<void> {
    const threadId = this.stateValue.projection?.thread.id
    if (threadId && typeof this.client.listGraphRuns === 'function') {
      try {
        const graphRuns = await this.client.listGraphRuns(threadId)
        if (this.stateValue.projection?.thread.id === threadId) {
          this.patch({ graphRuns })
        }
      } catch (error) {
        this.notify(`Could not load Graph status: ${safeMessage(error)}`, 'error')
        return
      }
    }
    const run = latestTuiGraphRun(this.stateValue.graphRuns, threadId)
    if (!run) {
      this.notify(
        'No GraphRun is attached to this session. Use /graph <requirement> to start one.',
        'error'
      )
      return
    }
    this.patch({ graphBoard: { runId: run.id }, inspection: undefined })
  }

  dismissGraphBoard(): void {
    this.patch({ graphBoard: undefined })
  }

  openGraphBoard(runId: string): boolean {
    const run = this.stateValue.graphRuns.find((candidate) => candidate.id === runId)
    if (!run) return false
    this.patch({ graphBoard: { runId }, inspection: undefined })
    return true
  }

  reasoningOptions(): readonly ModelReasoningEffort[] {
    return this.reasoningCapability()?.supportedEfforts ?? []
  }

  selectReasoningEffort(effort: ModelReasoningEffort): boolean {
    const options = this.reasoningOptions()
    if (!options.includes(effort)) {
      this.notify(options.length
        ? `Reasoning effort ${effort} is unavailable. Supported: ${options.join(', ')}.`
        : 'The selected model does not expose reasoning variants.', 'error')
      return false
    }
    this.patch({ reasoningEffort: effort })
    this.rememberReasoningEffort(effort)
    this.notify(`Reasoning effort: ${effort}`)
    return true
  }

  cycleReasoningEffort(direction: 1 | -1 = 1): boolean {
    const options = this.reasoningOptions()
    if (options.length <= 1) {
      this.notify(options.length === 1
        ? `This model only supports reasoning effort ${options[0]}.`
        : 'The selected model does not support selectable reasoning effort.', 'error')
      return false
    }
    const current = this.stateValue.reasoningEffort
    const index = Math.max(0, options.indexOf(current ?? options[0]!))
    const next = options[(index + direction + options.length) % options.length]!
    this.patch({ reasoningEffort: next })
    this.rememberReasoningEffort(next)
    this.notify(`Reasoning effort: ${next}`)
    return true
  }

  favoriteModelKeys(): ReadonlySet<string> {
    return new Set(this.persisted.favoriteModels)
  }

  isModelFavorite(providerId: string, accountId: string, model: string): boolean {
    return this.persisted.favoriteModels.includes(modelStateKey(providerId, accountId, model))
  }

  toggleModelFavorite(providerId: string, accountId: string, model: string): boolean {
    const key = modelStateKey(providerId, accountId, model)
    const favorites = new Set(this.persisted.favoriteModels)
    const added = !favorites.delete(key)
    if (added) favorites.add(key)
    this.persisted = { ...this.persisted, favoriteModels: [...favorites] }
    void this.savePersistentState()
    this.notify(`${added ? 'Favorited' : 'Unfavorited'} ${model}.`)
    return added
  }

  recentModels(): readonly TuiRecentModel[] {
    return this.persisted.recentModels
  }

  async selectModel(input: {
    providerId: string
    accountId: string
    model: string
  }): Promise<ModelConnectionSnapshot> {
    const snapshot = this.stateValue.modelConnections
    if (!snapshot) throw new Error('No model catalog is available.')
    const selectedProfile = snapshot.providers.find((candidate) =>
      candidate.id === input.providerId && candidate.accountId === input.accountId
    )
    if (!selectedProfile) throw new Error('The selected provider is no longer available.')
    if (!isModelConnectionProfileUsable(selectedProfile)) {
      throw new Error(modelConnectionUnavailableMessage(selectedProfile, input.providerId))
    }
    if (this.runtime.legacyGui) {
      if (!selectedProfile.models.includes(input.model)) {
        throw new Error('The selected model is no longer available.')
      }
      const updated: ModelConnectionSnapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        defaultProviderId: input.providerId,
        defaultAccountId: input.accountId,
        defaultModel: input.model,
        providers: snapshot.providers.map((candidate) => candidate.id === selectedProfile.id && candidate.accountId === selectedProfile.accountId
          ? { ...candidate, selectedModel: input.model }
          : candidate)
      }
      this.applyExplicitModelSelection(updated, input)
      return updated
    }
    try {
      const updated = await this.client.selectModel({
        expectedRevision: snapshot.revision,
        ...input
      })
      this.applyExplicitModelSelection(updated, input)
      return updated
    } catch (error) {
      if (error instanceof TuiClientError && error.status === 409) {
        const refreshed = await this.client.modelConnections()
        this.applyModelSelection(refreshed, false)
        throw new Error('Model connections changed in another client. The selector was refreshed; choose again.')
      }
      throw error
    }
  }

  /**
   * A /model pick also retargets the open session for its next turn. Shared
   * default changes from other clients keep it pinned (applyModelSelection).
   */
  private applyExplicitModelSelection(
    updated: ModelConnectionSnapshot,
    selection: { providerId: string; accountId: string; model: string }
  ): void {
    this.newThreadSelectionOverride = {}
    const projection = this.stateValue.projection
    if (projection) {
      this.options.providerId = selection.providerId
      this.options.accountId = selection.accountId
      this.options.model = selection.model
      this.pendingSessionSelections.set(projection.thread.id, { ...selection })
    }
    this.applyModelSelection(updated, false)
    const label = `${selection.providerId}/${selection.model}`
    this.notify(projection
      ? `Model: ${label}${projection.runningTurnId ? ' · applies from the next turn' : ''}`
      : `${this.runtime.legacyGui ? 'Shared model' : 'Default model'}: ${label}`)
  }

  async cycleRecentModel(direction: 1 | -1): Promise<boolean> {
    const snapshot = this.stateValue.modelConnections
    const recent = this.persisted.recentModels.filter((entry) => snapshot?.providers.some((profile) =>
      profile.id === entry.providerId &&
      profile.accountId === entry.accountId &&
      profile.models.includes(entry.model) &&
      isModelConnectionProfileUsable(profile)
    ))
    if (!snapshot || recent.length < 2) {
      this.notify('Use /model to select at least two models before cycling recent models.', 'error')
      return false
    }
    const active = this.activeModelSelection()
    const current = recent.findIndex((entry) =>
      entry.providerId === active.providerId &&
      entry.accountId === active.accountId &&
      entry.model === active.model
    )
    const index = (Math.max(0, current) + direction + recent.length) % recent.length
    const target = recent[index]!
    try {
      await this.selectModel(target)
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async showPlan(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const { todos } = await this.client.threadTodos(projection.thread.id)
      this.inspect('Plan', [
        `Mode: ${projection.thread.mode}`,
        ...(todos?.items.length
          ? todos.items.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)
          : ['No persisted plan tasks.'])
      ])
    } catch (error) {
      this.fail(error)
    }
  }
}
