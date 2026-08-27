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
import { TuiControllerThreads } from './controller-threads.js'

export abstract class TuiControllerTurns extends TuiControllerThreads {
  async submit(text: string, modeOverride?: 'agent' | 'plan'): Promise<void> {
    const prompt = text.trim()
    if (!prompt) return
    if (!this.stateValue.projection) {
      await this.createThread(prompt.slice(0, 80), { titleAuto: true })
      if (!this.stateValue.projection) return
    }
    const { thread, runningTurnId } = this.stateValue.projection
    const orchestration = (modeOverride ?? thread.mode) === 'agent'
      ? this.stateValue.composerOrchestration
      : 'direct'
    const activeGraphRun = orchestration === 'graph'
      ? latestTuiGraphRun(this.stateValue.graphRuns, thread.id)
      : undefined
    const steeringGraph = Boolean(
      activeGraphRun && !isTerminalGraphRun(activeGraphRun) && !runningTurnId
    )
    if (!runningTurnId && !steeringGraph) {
      const providerId = this.options.providerId ?? thread.providerId
      const accountId = this.options.accountId ?? thread.accountId
      const profile = this.stateValue.modelConnections?.providers.find((candidate) =>
        candidate.id === providerId && (!accountId || candidate.accountId === accountId)
      )
      if (
        this.stateValue.modelConnections &&
        (!profile || !isModelConnectionProfileUsable(profile))
      ) {
        this.notify(modelConnectionUnavailableMessage(profile, providerId), 'error')
        return
      }
    }
    if ((runningTurnId || steeringGraph) && this.stateValue.pendingAttachments.length) {
      this.notify('Attachments are kept for the next new turn; they cannot be added to queued guidance or Graph steering.', 'error')
      return
    }
    this.patch({
      busy: true,
      busyLabel: runningTurnId
        ? 'Queuing guidance'
        : steeringGraph
          ? 'Steering Graph'
          : 'Sending message',
      notification: undefined
    })
    try {
      if (runningTurnId) {
        await this.client.steerTurn(thread.id, runningTurnId, prompt)
        this.patch({ busy: false, notification: { kind: 'info', message: 'Guidance queued for the running turn.' } })
      } else if (steeringGraph && activeGraphRun) {
        const run = await this.client.steerGraphRun(activeGraphRun.id, prompt)
        this.patch({
          busy: false,
          graphRuns: replaceGraphRun(this.stateValue.graphRuns, run),
          notification: {
            kind: 'info',
            message: `Guidance persisted for Graph ${activeGraphRun.id}.`
          }
        })
      } else {
        const pendingAttachments = this.stateValue.pendingAttachments
        const model = this.options.model ?? thread.model
        const providerId = this.options.providerId ?? thread.providerId
        const accountId = this.options.accountId ?? thread.accountId
        const reasoningEffort = this.stateValue.reasoningEffort
        const started = await this.client.startTurn(thread.id, {
          prompt,
          clientSurface: 'tui',
          model,
          ...(providerId ? { providerId } : {}),
          ...(accountId ? { accountId } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          mode: modeOverride ?? thread.mode,
          orchestration,
          approvalPolicy: thread.approvalPolicy,
          sandboxMode: thread.sandboxMode,
          attachmentIds: pendingAttachments.map((attachment) => attachment.id)
        })
        void Promise.all(
          pendingAttachments.map((attachment) => this.releasePendingAttachment(attachment))
        )
        this.patch({
          projection: setProjectionRunningTurn(
            this.stateValue.projection,
            started.turnId,
            prompt,
            new Date().toISOString(),
            {
              model,
              ...(providerId ? { providerId } : {}),
              ...(accountId ? { accountId } : {}),
              ...(reasoningEffort ? { reasoningEffort } : {}),
              mode: modeOverride ?? thread.mode,
              orchestration,
              attachmentIds: pendingAttachments.map((attachment) => attachment.id)
            }
          ),
          busy: false,
          attachmentMetadata: mergeAttachmentMetadata(
            this.stateValue.attachmentMetadata,
            pendingAttachments
          ),
          pendingAttachments: []
        })
      }
    } catch (error) {
      if (isRefreshConflict(error)) await this.refreshActiveThread(error)
      else this.fail(error)
    }
  }

  async interrupt(): Promise<boolean> {
    const projection = this.stateValue.projection
    if (!projection?.runningTurnId) return false
    this.patch({ busy: true, busyLabel: 'Stopping turn' })
    try {
      await this.client.interruptTurn(projection.thread.id, projection.runningTurnId)
      this.patch({ busy: false, notification: { kind: 'info', message: 'Interrupt requested.' } })
      return true
    } catch (error) {
      await this.refreshActiveThread(error)
      return true
    }
  }

  async compact(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    this.patch({ busy: true, busyLabel: 'Compacting conversation' })
    try {
      await this.client.compactThread(projection.thread.id)
      this.patch({ busy: false, notification: { kind: 'info', message: 'Conversation compacted.' } })
      await this.reloadActiveThread()
    } catch (error) {
      this.fail(error)
    }
  }

  async rename(title: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const thread = await this.client.updateThread(projection.thread.id, { title, titleAuto: false })
      this.patch({ projection: { ...projection, thread: { ...projection.thread, ...thread } } })
      await this.refreshThreads(this.stateValue.threadSearch)
    } catch (error) {
      this.fail(error)
    }
  }

  async archive(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      await this.client.updateThread(projection.thread.id, { status: 'archived' })
      this.eventsAbort?.abort()
      this.patch({ view: 'threads', projection: undefined, notification: { kind: 'info', message: 'Session archived.' } })
      await this.refreshThreads('')
    } catch (error) {
      this.fail(error)
    }
  }

  async fork(title?: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const fork = await this.client.forkThread(projection.thread.id, { relation: 'fork', ...(title ? { title } : {}) })
      await this.refreshThreads('')
      await this.openThread(fork.id)
    } catch (error) {
      this.fail(error)
    }
  }

  async forkAtTurn(turnId: string, title?: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const fork = await this.client.forkThread(projection.thread.id, {
        relation: 'fork', turnId, ...(title ? { title } : {})
      })
      await this.refreshThreads('')
      await this.openThread(fork.id)
    } catch (error) {
      this.fail(error)
    }
  }

  async undoLastTurn(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    if (projection.runningTurnId) {
      this.notify('Interrupt the running turn before undoing.', 'error')
      return
    }
    const turns = projection.thread.turns
    let targetIndex = -1
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index]!.items.some((item) => item.kind === 'user_message')) {
        targetIndex = index
        break
      }
    }
    if (targetIndex < 0) {
      this.notify('There is no user turn to undo.', 'error')
      return
    }
    this.patch({ busy: true })
    try {
      const source = projection.thread
      const branch = await this.client.forkThread(source.id, {
        relation: 'fork',
        turnId: turns[targetIndex]!.id,
        beforeTurn: true,
        title: `${source.title} undo`
      })
      this.redoTargets.set(branch.id, source.id)
      this.persisted = {
        ...this.persisted,
        redoTargets: { ...this.persisted.redoTargets, [branch.id]: source.id }
      }
      await this.savePersistentState()
      await this.refreshThreads('')
      await this.openThread(branch.id)
      this.notify(`Undid the last user turn in a new branch; source ${source.id} is unchanged.`)
    } catch (error) {
      this.fail(error)
    }
  }

  async redoBranch(): Promise<void> {
    const currentId = this.stateValue.projection?.thread.id
    if (!currentId) {
      this.notify('Open a session first.', 'error')
      return
    }
    const explicitTarget = this.redoTargets.get(currentId)
    if (explicitTarget) {
      await this.openThread(explicitTarget)
      this.notify('Restored the source session that was preserved by undo.')
      return
    }
    await this.refreshThreads(this.stateValue.threadSearch, 'active')
    const next = this.stateValue.threads
      .filter((thread) => thread.parentThreadId === currentId && thread.relation === 'fork')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!next) {
      this.notify('There is no preserved child branch to redo.', 'error')
      return
    }
    await this.openThread(next.id)
    this.notify(`Moved to preserved branch ${next.title || next.id}.`)
  }

  async navigateSessionRelation(direction: 'parent' | 'child' | 'next-sibling' | 'previous-sibling'): Promise<void> {
    const current = this.stateValue.projection?.thread
    if (!current) {
      this.notify('Open a session first.', 'error')
      return
    }
    await this.refreshThreads(this.stateValue.threadSearch)
    let target: ThreadSummary | undefined
    if (direction === 'parent') {
      target = this.stateValue.threads.find((thread) => thread.id === current.parentThreadId)
    } else if (direction === 'child') {
      target = this.stateValue.threads
        .filter((thread) => thread.parentThreadId === current.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    } else {
      const siblings = this.stateValue.threads
        .filter((thread) => thread.parentThreadId && thread.parentThreadId === current.parentThreadId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const index = siblings.findIndex((thread) => thread.id === current.id)
      if (index >= 0 && siblings.length > 1) {
        const delta = direction === 'next-sibling' ? 1 : -1
        target = siblings[(index + delta + siblings.length) % siblings.length]
      }
    }
    if (!target) {
      this.notify(`No ${direction.replace('-', ' ')} session is available.`, 'error')
      return
    }
    await this.openThread(target.id)
  }
}
