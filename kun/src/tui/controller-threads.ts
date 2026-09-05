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
import { TuiControllerBase } from './controller-base.js'

export abstract class TuiControllerThreads extends TuiControllerBase {
  protected abstract hydrateAttachmentMetadata(attachmentIds: readonly string[], threadId: string, generation: number): Promise<void>

  override async refreshThreads(
    search = this.stateValue.threadSearch,
    mode = this.stateValue.threadListMode
  ): Promise<void> {
    this.patch({ busy: true, busyLabel: 'Loading sessions', threadSearch: search })
    try {
      const threads = await this.client.listThreads({
        search,
        archivedOnly: mode === 'archived'
      })
      threads.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))
      this.patch({
        threads,
        threadListMode: mode,
        selectedThreadIndex: Math.min(this.stateValue.selectedThreadIndex, Math.max(0, threads.length - 1)),
        busy: false,
        connection: 'connected'
      })
    } catch (error) {
      this.fail(error)
    }
  }

  selectThread(delta: number): void {
    const max = Math.max(0, this.stateValue.threads.length - 1)
    this.patch({ selectedThreadIndex: Math.max(0, Math.min(max, this.stateValue.selectedThreadIndex + delta)) })
  }

  async openSelectedThread(): Promise<void> {
    const selected = this.stateValue.threads[this.stateValue.selectedThreadIndex]
    if (selected) await this.openThread(selected.id)
  }

  async openQuickSession(slot: number): Promise<void> {
    const thread = this.stateValue.threads[slot - 1]
    if (!thread) {
      this.notify(`No session is assigned to quick slot ${slot}.`, 'error')
      return
    }
    await this.openThread(thread.id)
  }

  async toggleSelectedThreadPin(): Promise<void> {
    const selected = this.stateValue.threads[this.stateValue.selectedThreadIndex]
    if (!selected) return
    try {
      await this.client.updateThread(selected.id, { pinned: !selected.pinned })
      await this.refreshThreads(this.stateValue.threadSearch)
      this.notify(`${selected.pinned ? 'Unpinned' : 'Pinned'} session ${selected.title || selected.id}.`)
    } catch (error) {
      this.fail(error)
    }
  }

  async deleteSelectedThread(): Promise<void> {
    const selected = this.stateValue.threads[this.stateValue.selectedThreadIndex]
    if (!selected) return
    try {
      await this.client.deleteThread(selected.id)
      if (this.stateValue.projection?.thread.id === selected.id) {
        this.eventsAbort?.abort()
        this.patch({ projection: undefined, graphRuns: [] })
      }
      await this.refreshThreads(this.stateValue.threadSearch)
      this.notify(`Deleted session ${selected.title || selected.id}.`)
    } catch (error) {
      this.fail(error)
    }
  }

  async restoreSelectedThread(): Promise<void> {
    const selected = this.stateValue.threads[this.stateValue.selectedThreadIndex]
    if (!selected) return
    try {
      await this.client.updateThread(selected.id, { status: 'idle' })
      await this.refreshThreads(this.stateValue.threadSearch, 'archived')
      this.notify(`Restored session ${selected.title || selected.id}.`)
    } catch (error) {
      this.fail(error)
    }
  }

  override async openThread(threadId: string): Promise<void> {
    this.eventsAbort?.abort()
    const attachmentHydrationGeneration = ++this.attachmentHydrationGeneration
    this.attachmentMetadataRequests.clear()
    this.patch({ busy: true, busyLabel: 'Opening session', connection: 'connecting' })
    try {
      const delegationRequest = typeof this.client.delegationDiagnostics === 'function'
        ? this.client.delegationDiagnostics(threadId).catch(() => undefined)
        : Promise.resolve(undefined)
      const graphRunsRequest = typeof this.client.listGraphRuns === 'function'
        ? this.client.listGraphRuns(threadId).catch(() => [])
        : Promise.resolve([])
      const [detail, delegation, graphRuns] = await Promise.all([
        this.client.getThread(threadId),
        delegationRequest,
        graphRunsRequest
      ])
      const projection = hydrateProjectedChildRuns(projectThreadSnapshot(detail), delegation)
      const latestConfiguredTurn = [...detail.turns].reverse().find((turn) =>
        turn.model || turn.providerId || turn.accountId || turn.reasoningEffort
      )
      this.options.model = latestConfiguredTurn?.model ?? detail.model
      this.options.providerId = latestConfiguredTurn?.providerId ?? detail.providerId ?? this.options.providerId
      this.options.accountId = latestConfiguredTurn?.accountId ?? detail.accountId ?? this.options.accountId
      const reasoningEffort = this.resolveReasoningEffort({
        model: this.options.model,
        providerId: this.options.providerId,
        accountId: this.options.accountId,
        preferred: latestConfiguredTurn?.reasoningEffort ?? this.stateValue.reasoningEffort
      })
      this.patch({
        view: 'chat',
        projection,
        reasoningEffort,
        composerMode: detail.mode,
        graphRuns,
        attachmentMetadata: {},
        busy: false,
        connection: 'connecting',
        notification: undefined,
        inspection: undefined,
        graphBoard: undefined
      })
      void this.hydrateAttachmentMetadata(
        attachmentIdsFromProjection(projection),
        threadId,
        attachmentHydrationGeneration
      )
      const abort = new AbortController()
      this.eventsAbort = abort
      const subscription = this.client.subscribeThreadEvents({
        threadId,
        sinceSeq: projection.lastSeq,
        signal: abort.signal,
        onConnection: (connection) => {
          if (this.eventsAbort === abort) {
            // Older GUI runtimes implement this endpoint as a long poll and
            // may not flush SSE headers until the next event exists. The
            // authenticated thread snapshot already proved the runtime is
            // reachable, so don't leave an idle legacy session looking
            // disconnected while that first read is intentionally pending.
            this.patch({ connection: this.runtime.legacyGui && connection === 'connecting' ? 'connected' : connection })
          }
        },
        onEvent: (event) => {
          if (this.eventsAbort !== abort || this.stateValue.projection?.thread.id !== threadId) return
          const projection = applyRuntimeEvent(this.stateValue.projection, event)
          if (event.kind === 'turn_started' && !event.child) {
            this.options.model = event.model ?? this.options.model
            this.options.providerId = event.providerId ?? this.options.providerId
            this.options.accountId = event.accountId ?? this.options.accountId
          }
          this.patch({
            projection,
            ...(event.kind === 'turn_started' && !event.child
              ? {
                  reasoningEffort: this.resolveReasoningEffort({
                    model: event.model ?? this.options.model,
                    providerId: event.providerId ?? this.options.providerId,
                    accountId: event.accountId ?? this.options.accountId,
                    preferred: event.reasoningEffort ?? this.stateValue.reasoningEffort
                  })
                }
              : {})
          })
          if (event.kind === 'graph_event') {
            void this.reconcileGraphRun(event.graph.runId, threadId)
          }
          void this.hydrateAttachmentMetadata(
            attachmentIdsFromProjection(projection),
            threadId,
            attachmentHydrationGeneration
          )
        },
        onReplayResetRequired: async () => {
          const delegationRequest = typeof this.client.delegationDiagnostics === 'function'
            ? this.client.delegationDiagnostics(threadId).catch(() => undefined)
            : Promise.resolve(undefined)
          const graphRunsRequest = typeof this.client.listGraphRuns === 'function'
            ? this.client.listGraphRuns(threadId).catch(() => [])
            : Promise.resolve([])
          const [detail, delegation, graphRuns] = await Promise.all([
            this.client.getThread(threadId),
            delegationRequest,
            graphRunsRequest
          ])
          if (this.eventsAbort !== abort || abort.signal.aborted) {
            throw new Error('thread subscription was replaced during replay recovery')
          }
          const projection = hydrateProjectedChildRuns(projectThreadSnapshot(detail), delegation)
          this.patch({ projection, graphRuns, connection: 'connecting' })
          return projection.lastSeq
        },
        onError: (error) => {
          if (this.eventsAbort !== abort) return
          if (isMissingThread(error)) {
            abort.abort()
            if (this.stateValue.modelConnections) {
              this.applySharedDefaultToActiveSelection(this.stateValue.modelConnections)
            }
            this.patch({
              view: 'chat',
              projection: undefined,
              graphRuns: [],
              connection: 'disconnected',
              notification: { kind: 'error', message: 'This session was removed by another client. Choose or create a session.' }
            })
            void this.refreshThreads('')
            return
          }
          this.patch({ notification: { kind: 'error', message: safeMessage(error) } })
        }
      })
      this.activeSubscription = subscription
      void subscription.finally(() => {
        if (this.eventsAbort === abort && !abort.signal.aborted) this.patch({ connection: 'disconnected' })
      })
    } catch (error) {
      this.fail(error)
    }
  }

  async createThread(
    title?: string,
    options: { titleAuto?: boolean } = {}
  ): Promise<void> {
    const sessionTitle = title?.trim() || 'Terminal chat'
    const titleAuto = options.titleAuto ?? !title?.trim()
    this.patch({ busy: true, busyLabel: 'Creating session' })
    try {
      const selection = this.newThreadSelection()
      const snapshot = this.stateValue.modelConnections
      const selectedProfile = snapshot?.providers.find((profile) =>
        profile.id === selection.providerId &&
        (!selection.accountId || profile.accountId === selection.accountId)
      )
      if (
        snapshot &&
        (
          !selection.providerId ||
          !selection.model ||
          !selectedProfile ||
          !isModelConnectionProfileUsable(selectedProfile)
        )
      ) {
        this.patch({
          busy: false,
          busyLabel: undefined,
          notification: {
            kind: 'error',
            message: 'No connected default model. Use /connect to connect a provider before creating a session.'
          }
        })
        return
      }
      const thread = await this.client.createThread({
        title: sessionTitle,
        titleAuto,
        workspace: this.options.workspace,
        model: selection.model ?? this.runtime.runtimeInfo.model ?? 'deepseek-chat',
        ...(selection.providerId ? { providerId: selection.providerId } : {}),
        ...(selection.accountId ? { accountId: selection.accountId } : {}),
        mode: this.stateValue.composerMode,
        ...(this.options.approvalPolicy
          ? { approvalPolicy: this.options.approvalPolicy }
          : {}),
        ...(this.options.sandboxMode
          ? { sandboxMode: this.options.sandboxMode }
          : {}),
        ...(this.options.approvalReviewer
          ? { approvalReviewer: this.options.approvalReviewer }
          : {})
      })
      await this.openThread(thread.id)
      await this.refreshThreads('')
    } catch (error) {
      this.fail(error)
    }
  }
}
