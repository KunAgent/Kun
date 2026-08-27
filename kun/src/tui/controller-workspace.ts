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
import { TuiControllerAttachments } from './controller-attachments.js'

export abstract class TuiControllerWorkspace extends TuiControllerAttachments {
  async manageMemory(action?: string): Promise<void> {
    const workspace = this.stateValue.projection?.thread.workspace ?? this.options.workspace
    const value = action?.trim() ?? ''
    try {
      await this.ensureLocalCapability('memory')
      if (!value || value === 'list') {
        const { memories } = await this.client.listMemories({ workspace })
        this.inspect('Memory', memories.length
          ? memories.map((memory, index) =>
              `${index + 1}. ${memory.disabledAt ? '[disabled] ' : ''}${memory.content}\n   ${memory.id} · ${memory.scope} · ${memory.tags.join(', ') || 'no tags'}`
            )
          : ['No persistent memories for this workspace.', 'Usage: /memory add <text>'])
        return
      }
      const [verb = '', id = '', ...rest] = splitWords(value)
      if (verb === 'add') {
        const content = [id, ...rest].join(' ').trim()
        if (!content) throw new Error('Usage: /memory add <text>')
        await this.client.createMemory({ content, scope: 'workspace', workspace, tags: [] })
        this.notify('Workspace memory added.')
        return
      }
      if (verb === 'edit') {
        const content = rest.join(' ').trim()
        if (!id || !content) throw new Error('Usage: /memory edit <id> <text>')
        await this.client.updateMemory(id, workspace, { content })
        this.notify('Memory updated.')
        return
      }
      if (verb === 'disable' || verb === 'enable') {
        if (!id) throw new Error(`Usage: /memory ${verb} <id>`)
        await this.client.updateMemory(id, workspace, { disabled: verb === 'disable' })
        this.notify(`Memory ${verb}d.`)
        return
      }
      if (verb === 'delete') {
        if (!id) throw new Error('Usage: /memory delete <id>')
        await this.client.deleteMemory(id, workspace)
        this.notify('Memory deleted.')
        return
      }
      throw new Error('Usage: /memory [list|add <text>|edit <id> <text>|enable <id>|disable <id>|delete <id>]')
    } catch (error) {
      this.fail(error)
    }
  }

  async manageTodos(action?: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    const value = action?.trim() ?? ''
    try {
      const current = (await this.client.threadTodos(projection.thread.id)).todos?.items ?? []
      if (!value || value === 'list') {
        this.inspect('Plan', current.length
          ? current.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}\n   ${todo.id}`)
          : ['No persisted plan tasks.', 'Usage: /tasks add <task>'])
        return
      }
      const [verb = '', target = '', ...rest] = splitWords(value)
      if (verb === 'clear') {
        await this.client.clearThreadTodos(projection.thread.id)
        this.notify('Plan tasks cleared.')
        return
      }
      let next: Array<{
        id?: string
        content: string
        status: ThreadTodoStatus
        source?: ThreadTodoItem['source']
      }> = current.map(todoInput)
      if (verb === 'add') {
        const content = [target, ...rest].join(' ').trim()
        if (!content) throw new Error('Usage: /tasks add <task>')
        next.push({ content, status: 'pending' })
      } else if (['start', 'done', 'pending'].includes(verb)) {
        const selected = resolveTodo(current, target)
        if (!selected) throw new Error(`Unknown task: ${target}`)
        const status: ThreadTodoStatus = verb === 'start'
          ? 'in_progress'
          : verb === 'done'
            ? 'completed'
            : 'pending'
        next = next.map((todo) => todo.id === selected.id
          ? { ...todo, status }
          : status === 'in_progress' && todo.status === 'in_progress'
            ? { ...todo, status: 'pending' }
            : todo)
      } else if (verb === 'edit') {
        const selected = resolveTodo(current, target)
        const content = rest.join(' ').trim()
        if (!selected || !content) throw new Error('Usage: /tasks edit <number|id> <text>')
        next = next.map((todo) => todo.id === selected.id ? { ...todo, content } : todo)
      } else if (verb === 'delete') {
        const selected = resolveTodo(current, target)
        if (!selected) throw new Error(`Unknown task: ${target}`)
        next = next.filter((todo) => todo.id !== selected.id)
      } else if (verb === 'move') {
        const from = Number(target) - 1
        const to = Number(rest[0]) - 1
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || !next[from] || to < 0 || to >= next.length) {
          throw new Error('Usage: /tasks move <from-number> <to-number>')
        }
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
      } else {
        throw new Error('Usage: /tasks [list|add|edit|start|done|pending|delete|move|clear]')
      }
      await this.client.setThreadTodos(projection.thread.id, { todos: next })
      this.notify('Plan tasks updated.')
    } catch (error) {
      this.fail(error)
    }
  }

  async manageGoal(action?: string): Promise<void> {
    const value = action?.trim() ?? ''
    const projection = this.stateValue.projection
    if (!projection) {
      const lowered = value.toLowerCase()
      if (value && !['status', 'pause', 'resume', 'clear', 'cancel'].includes(lowered)) {
        await this.activateGoal(lowered.startsWith('set ') ? value.slice(4).trim() : value)
      } else {
        this.notify('No session goal exists yet. Use /goal <objective> to create one.', 'error')
      }
      return
    }
    try {
      if (!value || value.toLowerCase() === 'status') {
        const { goal } = await this.client.threadGoal(projection.thread.id)
        this.inspect('Goal', goal
          ? [
              `Status: ${goal.status}`,
              `Objective: ${goal.objective}`,
              `Tokens: ${goal.tokensUsed.toLocaleString()}${goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ''}`,
              `Time: ${goal.timeUsedSeconds}s`
            ]
          : ['No active goal. Use /goal <objective> to create one.'])
        return
      }
      const lowered = value.toLowerCase()
      if (lowered === 'clear' || lowered === 'cancel') {
        await this.clearGoal()
        return
      }
      if (lowered === 'pause' || lowered === 'resume') {
        await this.setGoalStatus(lowered === 'pause' ? 'paused' : 'active')
        return
      }
      const objective = lowered.startsWith('set ') ? value.slice(4).trim() : value
      await this.activateGoal(objective)
    } catch (error) {
      this.fail(error)
    }
  }

  /**
   * Goal is a persistent execution workflow layered on top of agent turns,
   * not a third value in the runtime's ThreadMode contract. Activating it
   * therefore returns the thread to agent mode, saves the durable objective,
   * and launches (or steers) the first goal turn just like the GUI.
   */
  async activateGoal(objective: string, tokenBudget?: number | null): Promise<boolean> {
    const trimmed = objective.trim()
    if (!trimmed) return false
    this.patch({ composerMode: 'agent', composerOrchestration: 'direct' })
    if (!this.stateValue.projection) {
      await this.createThread(trimmed.slice(0, 80), { titleAuto: true })
    }
    const projection = this.requireProjection()
    if (!projection) return false
    this.patch({ busy: true, busyLabel: 'Starting goal' })
    try {
      if (projection.thread.mode !== 'agent') {
        await this.client.updateThread(projection.thread.id, { mode: 'agent' })
      }
      await this.client.setThreadGoal(projection.thread.id, {
        objective: trimmed,
        status: 'active',
        ...(tokenBudget !== undefined ? { tokenBudget } : {})
      })
      await this.reloadActiveThread()
      await this.submit(trimmed, 'agent')
      this.notify('Goal mode active · Kun will keep working until complete, paused, or blocked.')
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async setGoalStatus(status: ThreadGoalStatus): Promise<boolean> {
    const projection = this.requireProjection()
    if (!projection?.thread.goal) {
      this.notify('No goal exists yet. Choose Goal mode and enter an objective.', 'error')
      return false
    }
    this.patch({ busy: true, busyLabel: status === 'active' ? 'Resuming goal' : 'Updating goal' })
    try {
      if (status === 'active') {
        this.patch({ composerMode: 'agent', composerOrchestration: 'direct' })
      }
      if (status === 'active' && projection.thread.mode !== 'agent') {
        await this.client.updateThread(projection.thread.id, { mode: 'agent' })
      }
      await this.client.setThreadGoal(projection.thread.id, { status })
      await this.reloadActiveThread()
      if (status === 'active' && !this.stateValue.projection?.runningTurnId) {
        await this.submit('Continue working toward the active goal.', 'agent')
      }
      this.notify(status === 'active' ? 'Goal resumed.' : `Goal ${status}.`)
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async setGoalBudget(tokenBudget: number | null): Promise<boolean> {
    const projection = this.requireProjection()
    if (!projection?.thread.goal) return false
    try {
      await this.client.setThreadGoal(projection.thread.id, { tokenBudget })
      await this.reloadActiveThread()
      this.notify(tokenBudget === null ? 'Goal token budget removed.' : `Goal token budget: ${tokenBudget.toLocaleString()}`)
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async clearGoal(): Promise<boolean> {
    const projection = this.requireProjection()
    if (!projection?.thread.goal) return false
    try {
      await this.client.clearThreadGoal(projection.thread.id)
      await this.reloadActiveThread()
      this.notify('Goal cleared.')
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async showStatus(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    const thread = projection.thread
    const graph = latestTuiGraphRun(this.stateValue.graphRuns, thread.id)
    const graphProgress = graph ? summarizeTuiGraphRun(graph) : undefined
    this.inspect('Status', [
      `Connection: ${this.stateValue.connection}`,
      `Runtime: ${this.runtime.runtimeInfo.serviceVersion ?? 'unknown'} · ${this.runtime.runtimeInfo.instanceId ?? 'unknown'} · PID ${this.runtime.runtimeInfo.pid ?? 'unknown'}`,
      `URL: ${this.runtime.baseUrl}`,
      `Session: ${thread.title} (${thread.id})`,
      `State: ${thread.status}${projection.runningTurnId ? ` · turn ${projection.runningTurnId}` : ''}`,
      `Model: ${thread.providerId ? `${thread.providerId}/` : ''}${thread.model}`,
      `Reasoning: ${this.stateValue.reasoningEffort ?? 'model default'}`,
      `Workspace: ${thread.workspace}`,
      `Mode: ${thread.goal?.status === 'active' ? 'goal' : thread.mode}`,
      `Orchestration: ${this.stateValue.composerOrchestration}`,
      ...(graphProgress ? [
        `Graph: ${graphProgress.status} · ${graphProgress.accepted}/${graphProgress.total} accepted · ${graphProgress.activeAgents} active agents · revision ${graphProgress.revision}`
      ] : []),
      ...(thread.goal ? [
        `Goal: ${thread.goal.status} · ${thread.goal.objective}`,
        `Goal usage: ${thread.goal.tokensUsed.toLocaleString()} tokens · ${thread.goal.timeUsedSeconds}s`
      ] : []),
      ...(thread.additionalWorkspaces ?? []).map((path) => `Additional workspace: ${path}`),
      `Permissions: ${thread.approvalPolicy} · ${thread.sandboxMode}`
    ])
  }
}
