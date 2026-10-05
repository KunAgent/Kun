import { randomUUID } from 'node:crypto'
import type {
  AppSettingsV1,
  WorkflowInputFieldV1,
  WorkflowApprovalDecision,
  WorkflowNodeRunResultV1,
  WorkflowNodeTestResult,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowRunV1,
  WorkflowRuntimeStatus,
  WorkflowV1
} from '../shared/app-settings'
import { MAX_WORKFLOW_RUNS } from '../shared/app-settings-workflow'
import {
  SCHEDULER_INTERVAL_MS,
  hasEnabledScheduledTask,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'
import { selectWorkflowTrigger } from './workflow-graph-planner'
import { WorkflowRunCoordinator } from './workflow-run-coordinator'
import { WorkflowScheduler } from './workflow-scheduler'
import {
  safeJson,
  type InterpScope,
  type WorkflowPayload
} from './workflow-expression'
import {
  resolveWorkflowEnv as resolveEnv,
  resolveWorkflowRunWorkspace as resolveRunWorkspace
} from './workflow-graph-executor'
import {
  LIVE_STATUS_LINGER_MS,
  activeScheduleTriggers,
  coerceInputToPayload,
  computeWorkflowNextRunAt,
  hasEnabledScheduledWorkflow,
  missingRequiredInput,
  summarizeRun,
  workflowHasScheduleTrigger,
  cronNextRun
} from './workflow-runtime-helpers'
import { WorkflowNodeExecutionService } from './workflow-node-execution-service'
import { WorkflowWebhookServer } from './workflow-webhook-server'

export { checkWorkflowCode } from './workflow-code-node-adapter'
export type { InterpScope } from './workflow-expression'
export {
  computeWorkflowNextRunAt,
  cronNextRun,
  hasEnabledScheduledWorkflow,
  workflowHasScheduleTrigger
} from './workflow-runtime-helpers'

export class WorkflowRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private readonly runCoordinator = new WorkflowRunCoordinator()
  private readonly scheduler: WorkflowScheduler
  private readonly nodeExecution: WorkflowNodeExecutionService
  private readonly webhookServer: WorkflowWebhookServer
  private workflowUpdateTail: Promise<void> = Promise.resolve()
  /** Recursion guard: true while a hook-triggered workflow is running, so its own
   * tool calls (via AI-agent nodes) don't re-trigger hooks and loop forever. */
  private hookRunActive = false
  private powerSaveBlockerId: number | null = null
  private readonly stopController = new AbortController()
  private readonly activeRunTasks = new Set<Promise<unknown>>()
  private stopping = false
  private stopPromise: Promise<void> | null = null

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
    this.scheduler = new WorkflowScheduler({
      intervalMs: SCHEDULER_INTERVAL_MS,
      tick: () => this.tick()
    })
    this.nodeExecution = new WorkflowNodeExecutionService(deps, this.runCoordinator)
    this.webhookServer = new WorkflowWebhookServer({
      loadSettings: () => this.loadSettings(),
      logError: deps.logError,
      runWorkflowByRef: (idOrName, input, workspaceOverride) =>
        this.runWorkflowByRef(idOrName, input, workspaceOverride),
      runWorkflowInternal: (workflow, triggerNodeId, triggerLabel, runId, payload) =>
        this.runWorkflowInternal(workflow, triggerNodeId, triggerLabel, runId, payload),
      runForHook: (idOrName, payload, workspaceOverride) =>
        this.runForHook(idOrName, payload, workspaceOverride),
      runWorkflowForTool: (idOrName, input, workspaceOverride) =>
        this.runWorkflowForTool(idOrName, input, workspaceOverride)
    })
  }

  private async loadSettings(): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    return this.deps.withModelCredentials
      ? this.deps.withModelCredentials(settings)
      : settings
  }

  sync(settings: AppSettingsV1): void {
    if (this.stopping) return
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    this.webhookServer.sync(settings)
    void this.ensureNextRuns(settings)
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    this.stopController.abort()
    this.runCoordinator.cancelAll()
    this.scheduler.stop()
    this.stopPowerSaveBlocker()
    this.webhookServer.close()
    this.stopPromise = (async () => {
      await Promise.allSettled([...this.activeRunTasks])
      await this.workflowUpdateTail.catch(() => undefined)
    })()
    return this.stopPromise
  }


  async runWorkflowForTool(
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }> {
    const settings = await this.loadSettings()
    const lower = idOrName.toLowerCase()
    const workflow = settings.workflow.workflows.find(
      (item) => item.enabled && item.callableByAgent && (item.id === idOrName || item.name.toLowerCase() === lower)
    )
    if (!workflow) {
      return { ok: false, status: 'error', message: `No agent-callable workflow matches "${idOrName}".`, output: '', runId: '' }
    }
    return this.runResolved(workflow, input, workspaceOverride)
  }

  /**
   * Run a workflow triggered by a kun agent hook. Resolves by id (no callableByAgent
   * gate — the trigger binding is the gate). Reentrancy-guarded: while one hook run is
   * in flight, further hook runs are skipped so a workflow that edits files can't loop.
   */
  async runForHook(
    workflowId: string,
    input: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string; skipped: boolean }> {
    if (this.hookRunActive) {
      return { ok: true, status: 'success', message: 'skipped (hook already running)', output: '', runId: '', skipped: true }
    }
    const settings = await this.loadSettings()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) {
      return { ok: false, status: 'error', message: `Hook workflow "${workflowId}" not found.`, output: '', runId: '', skipped: false }
    }
    this.hookRunActive = true
    try {
      const result = await this.runResolved(workflow, input, workspaceOverride)
      return { ...result, skipped: false }
    } finally {
      this.hookRunActive = false
    }
  }

  /** Run any workflow by id or name (no callableByAgent gate) — for the local POST /workflow/run API. */
  async runWorkflowByRef(
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }> {
    const settings = await this.loadSettings()
    const lower = idOrName.toLowerCase()
    const workflow = settings.workflow.workflows.find(
      (item) => item.enabled && (item.id === idOrName || item.name.toLowerCase() === lower)
    )
    if (!workflow) {
      return {
        ok: false,
        status: 'error',
        message: `No enabled workflow matches "${idOrName}". Enable the workflow to expose it over HTTP.`,
        output: '',
        runId: ''
      }
    }
    return this.runResolved(workflow, input, workspaceOverride)
  }

  private async runResolved(
    workflow: WorkflowV1,
    input: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }> {
    if (this.stopping) {
      return { ok: false, status: 'error', message: 'Workflow runtime is stopping.', output: '', runId: '' }
    }
    if (this.runCoordinator.isRunning(workflow.id)) {
      return { ok: false, status: 'error', message: 'Workflow is already running.', output: '', runId: '' }
    }
    // Prefer an enabled trigger (manual > schedule > webhook); fall back to any trigger.
    const trigger = selectWorkflowTrigger(workflow, true) ?? selectWorkflowTrigger(workflow)
    if (!trigger) {
      return { ok: false, status: 'error', message: 'Workflow has no trigger node.', output: '', runId: '' }
    }
    const inputSchema = trigger.type === 'manual-trigger' ? trigger.config.inputSchema : undefined
    const missing = missingRequiredInput(inputSchema, input)
    if (missing) {
      return { ok: false, status: 'error', message: `Missing required input: ${missing}`, output: '', runId: '' }
    }
    const runId = randomUUID()
    const initialPayload = coerceInputToPayload(inputSchema, input)
    const result = await this.runWorkflowInternal(workflow, trigger.id, 'agent', runId, initialPayload, workspaceOverride)
    const after = await this.loadSettings()
    const run = after.workflow.workflows.find((item) => item.id === workflow.id)?.runs.find((entry) => entry.id === runId)
    const status: WorkflowRunStatus = 'status' in result ? result.status : 'error'
    const output = this.pickRunOutput(workflow, run) || result.message
    return { ok: result.ok, status, message: result.message, output, runId }
  }

  /** The run's canonical output: the last successful `output` node's result, else the last node's. */
  private pickRunOutput(workflow: WorkflowV1, run: WorkflowRunV1 | undefined): string {
    if (!run) return ''
    const outputIds = new Set(workflow.nodes.filter((node) => node.type === 'output').map((node) => node.id))
    const fromOutput = [...run.nodeResults]
      .reverse()
      .find((entry) => outputIds.has(entry.nodeId) && entry.status === 'success')
    const chosen = fromOutput ?? run.nodeResults[run.nodeResults.length - 1]
    return chosen?.outputJson ?? ''
  }

  async status(): Promise<WorkflowRuntimeStatus> {
    return this.runCoordinator.status(this.isPowerSaveBlockerActive())
  }

  /** Resolve a paused human-approval node. Returns false if the token is unknown (e.g. already decided). */
  resolveApproval(token: string, decision: WorkflowApprovalDecision): boolean {
    return this.runCoordinator.resolveApproval(token, decision)
  }

  async runWorkflow(workflowId: string, input?: unknown): Promise<WorkflowRunResult> {
    if (this.stopping) return { ok: false, message: 'Workflow runtime is stopping.' }
    const settings = await this.loadSettings()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    if (this.runCoordinator.isRunning(workflowId)) return { ok: false, message: 'Workflow is already running.' }
    const trigger = selectWorkflowTrigger(workflow)
    if (!trigger) return { ok: false, message: 'Workflow has no trigger node.' }
    const inputSchema = trigger.type === 'manual-trigger' ? trigger.config.inputSchema : undefined
    const missing = missingRequiredInput(inputSchema, input)
    if (missing) return { ok: false, message: `Missing required input: ${missing}` }
    const runId = randomUUID()
    const initialPayload = coerceInputToPayload(inputSchema, input)
    // Fire-and-poll: the UI watches status() for per-node progress.
    void this.runWorkflowInternal(workflow, trigger.id, 'manual', runId, initialPayload)
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  async stopWorkflow(workflowId: string): Promise<WorkflowRunResult> {
    if (!this.runCoordinator.requestCancel(workflowId)) return { ok: false, message: 'Workflow is not running.' }
    return { ok: true, runId: '', status: 'running', message: 'Stopping' }
  }

  async runSingleNode(workflowId: string, nodeId: string): Promise<WorkflowRunResult> {
    if (this.stopping) return { ok: false, message: 'Workflow runtime is stopping.' }
    const settings = await this.loadSettings()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, message: 'Node not found.' }
    const runId = randomUUID()
    const task = (async () => {
      const live = this.runCoordinator.beginSingleNode(workflowId, nodeId)
      try {
        await this.nodeExecution.executeNode(
          node,
          { json: {}, text: '' },
          settings,
          undefined,
          0,
          resolveRunWorkspace(workflow, settings),
          {},
          {},
          undefined,
          this.stopController.signal
        )
        live.set(nodeId, 'success')
      } catch {
        live.set(nodeId, 'error')
      } finally {
        this.runCoordinator.finishSingleNode(workflowId, LIVE_STATUS_LINGER_MS, live)
      }
    })()
    this.trackRunTask(task)
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  /** Run a single node in isolation against a mock upstream payload, returning its result (not persisted). */
  async testNode(workflowId: string, nodeId: string, mockJson: string): Promise<WorkflowNodeTestResult> {
    if (this.stopping) return { ok: false, message: 'Workflow runtime is stopping.' }
    const settings = await this.loadSettings()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, message: 'Node not found.' }
    if (node.type.endsWith('-trigger')) return { ok: false, message: 'Trigger nodes cannot be tested.' }

    let mockValue: unknown = {}
    const trimmed = mockJson.trim()
    if (trimmed) {
      try {
        mockValue = JSON.parse(trimmed)
      } catch {
        mockValue = trimmed
      }
    }
    const payload: WorkflowPayload = {
      json: mockValue,
      text: typeof mockValue === 'string' ? mockValue : safeJson(mockValue)
    }
    const env = resolveEnv(workflow.env)
    const secretValues = workflow.env
      .filter((entry) => entry.type === 'secret' && entry.value.trim())
      .map((entry) => entry.value)
    const redact = (text: string): string => secretValues.reduce((acc, secret) => acc.split(secret).join('***'), text)
    const scope: InterpScope = { nodes: {}, env, run: {} }
    const startedAt = new Date()
    const inputJson = redact(safeJson(payload.json))
    try {
      const outcome = await this.nodeExecution.executeNode(
        node,
        payload,
        settings,
        [payload],
        0,
        resolveRunWorkspace(workflow, settings),
        scope,
        {},
        undefined,
        this.stopController.signal
      )
      return {
        ok: true,
        result: {
          nodeId,
          status: 'success',
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          message: redact(outcome.message),
          outputJson: redact(safeJson(outcome.payload.json)),
          inputJson,
          retries: 0,
          threadId: outcome.threadId ?? '',
          error: ''
        }
      }
    } catch (error) {
      return {
        ok: true,
        result: {
          nodeId,
          status: 'error',
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          message: '',
          outputJson: '',
          inputJson,
          retries: 0,
          threadId: '',
          error: redact(error instanceof Error ? error.message : String(error))
        }
      }
    }
  }

  private startScheduler(): void {
    this.scheduler.start()
  }

  private async tick(): Promise<void> {
    if (this.stopping) return
    const settings = await this.loadSettings()
    if (!settings.workflow.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.loadSettings()
    const now = Date.now()
    for (const workflow of fresh.workflow.workflows) {
      if (!workflow.enabled || this.runCoordinator.isRunning(workflow.id)) continue
      const trigger = activeScheduleTriggers(workflow)[0]
      if (!trigger) continue
      const dueAt = Date.parse(workflow.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runWorkflowInternal(workflow, trigger.id, 'schedule')
    }
  }

  private async ensureNextRuns(_settings: AppSettingsV1): Promise<void> {
    if (this.stopping) return
    const now = new Date()
    const saved = await this.deps.store.update((current) => {
      if (!current.workflow.enabled) return current
      let changed = false
      const workflows = current.workflow.workflows.map((workflow) => {
        const wasInterrupted = workflow.lastStatus === 'running' && !this.runCoordinator.isRunning(workflow.id)
        const scheduled = workflowHasScheduleTrigger(workflow)
        if (!workflow.enabled || !scheduled || this.runCoordinator.isRunning(workflow.id)) {
          if (!wasInterrupted) return workflow
          changed = true
          return {
            ...workflow,
            lastStatus: 'error' as const,
            lastMessage: 'Workflow was interrupted before completion.',
            updatedAt: now.toISOString()
          }
        }
        if (workflow.nextRunAt && !wasInterrupted) return workflow
        changed = true
        return {
          ...workflow,
          nextRunAt: computeWorkflowNextRunAt(workflow, now),
          ...(wasInterrupted
            ? {
                lastStatus: 'error' as const,
                lastMessage: 'Workflow was interrupted before completion.',
                updatedAt: now.toISOString()
              }
            : {})
        }
      })
      if (!changed) return current
      return { ...current, workflow: { ...current.workflow, workflows } }
    })
    this.syncPowerSaveBlocker(saved)
  }

  private updateWorkflow(
    workflowId: string,
    updater: (workflow: WorkflowV1) => WorkflowV1
  ): Promise<AppSettingsV1> {
    const update = this.workflowUpdateTail.then(async () => {
      const saved = await this.deps.store.update((current) => {
        const workflows = current.workflow.workflows.map((workflow) =>
          workflow.id === workflowId ? updater(workflow) : workflow
        )
        return { ...current, workflow: { ...current.workflow, workflows } }
      })
      this.syncPowerSaveBlocker(saved)
      return saved
    })
    this.workflowUpdateTail = update.then(() => undefined, () => undefined)
    return update
  }

  private setLive(workflowId: string, nodeId: string, status: WorkflowNodeRunStatus): void {
    this.runCoordinator.setLive(workflowId, nodeId, status)
  }

  /** Surface a per-node result (input/output/timing) live so the editor can show run logs as it runs. */
  private setLiveResult(workflowId: string | undefined, result: WorkflowNodeRunResultV1): void {
    this.runCoordinator.setLiveResult(workflowId, result)
  }

  private runWorkflowInternal(
    workflow: WorkflowV1,
    triggerNodeId: string,
    triggerLabel: string,
    runId = randomUUID(),
    initialPayload: WorkflowPayload = { json: {}, text: '' },
    workspaceOverride?: string
  ): Promise<WorkflowRunResult> {
    if (this.stopping) {
      return Promise.resolve({ ok: false, runId, status: 'error', message: 'Workflow runtime is stopping.' })
    }
    return this.trackRunTask(this.runWorkflowOwned(
      workflow,
      triggerNodeId,
      triggerLabel,
      runId,
      initialPayload,
      workspaceOverride
    ))
  }

  private trackRunTask<T>(task: Promise<T>): Promise<T> {
    this.activeRunTasks.add(task)
    void task.then(
      () => this.activeRunTasks.delete(task),
      () => this.activeRunTasks.delete(task)
    )
    return task
  }

  private async runWorkflowOwned(
    workflow: WorkflowV1,
    triggerNodeId: string,
    triggerLabel: string,
    runId = randomUUID(),
    initialPayload: WorkflowPayload = { json: {}, text: '' },
    workspaceOverride?: string
  ): Promise<WorkflowRunResult> {
    if (!this.runCoordinator.begin(workflow.id, workflow.nodes.map((node) => node.id))) {
      return { ok: false, message: 'Workflow is already running.' }
    }
    try {
      const signal = this.runCoordinator.signal(workflow.id) ?? this.stopController.signal
      const startedAt = new Date()
      const run: WorkflowRunV1 = {
        id: runId,
        trigger: triggerLabel,
        status: 'running',
        startedAt: startedAt.toISOString(),
        finishedAt: '',
        message: '',
        nodeResults: []
      }
      const startError = await this.persistRunUpdate(workflow.id, runId, 'start', (current) => ({
        ...current,
        lastStatus: 'running',
        lastMessage: 'Running',
        nextRunAt: '',
        updatedAt: startedAt.toISOString(),
        runs: [...current.runs, run].slice(-MAX_WORKFLOW_RUNS)
      }))
      if (startError) return { ok: false, message: startError }

      let runStatus: WorkflowRunStatus = 'success'
      let runMessage = ''
      let nodeResults: WorkflowNodeRunResultV1[] = []
      try {
        const settings = await this.loadSettings()
        const result = await this.nodeExecution.runGraph(workflow, triggerNodeId, initialPayload, {
          settings,
          statusWorkflowId: workflow.id,
          cancelId: workflow.id,
          runId,
          depth: 0,
          signal,
          workspaceOverride
        })
        runStatus = signal.aborted ? 'error' : result.status
        nodeResults = result.nodeResults
        runMessage = signal.aborted ? 'Canceled.' : runStatus === 'success' ? summarizeRun(nodeResults) : result.errorMessage
      } catch (error) {
        runStatus = 'error'
        runMessage = error instanceof Error ? error.message : String(error)
        this.deps.logError('workflow', 'Workflow run failed', { message: runMessage, workflowId: workflow.id })
      }
      const finishedAt = new Date()
      const finishError = await this.persistRunUpdate(workflow.id, runId, 'finish', (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        lastStatus: runStatus,
        lastMessage: runMessage,
        nextRunAt: computeWorkflowNextRunAt(current, finishedAt),
        updatedAt: finishedAt.toISOString(),
        runs: current.runs.map((entry) =>
          entry.id === runId
            ? { ...entry, status: runStatus, finishedAt: finishedAt.toISOString(), message: runMessage, nodeResults }
            : entry
        )
      }))
      if (finishError) {
        return { ok: false, message: [runMessage, finishError].filter(Boolean).join(' ') }
      }
      return { ok: runStatus !== 'error', runId, status: runStatus, message: runMessage }
    } finally {
      // Ownership cannot depend on a successful settings read/write or error report.
      this.runCoordinator.finish(workflow.id, runId, LIVE_STATUS_LINGER_MS)
    }
  }

  private async persistRunUpdate(
    workflowId: string,
    runId: string,
    phase: 'start' | 'finish',
    updater: (workflow: WorkflowV1) => WorkflowV1
  ): Promise<string | undefined> {
    try {
      await this.updateWorkflow(workflowId, updater)
      return undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('workflow-persistence', 'Failed to save workflow run', { workflowId, runId, phase, message })
      return `Failed to save workflow run ${phase}: ${message}`
    }
  }

  /**
   * Pruning dataflow scheduler over one workflow graph. A node runs once all its
   * incoming edges are resolved (delivered a payload, or pruned). Conditions /
   * switches prune the branches they don't take, cascading to make downstream
   * nodes unreachable — so joins (Merge) wait only for branches that fire.
   * Pure: no persistence. Used by both top-level runs and sub-workflow nodes.
   */

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const shouldKeepAwake =
      settings.workflow.keepAwake && settings.workflow.enabled && hasEnabledScheduledWorkflow(settings)
    if (!shouldKeepAwake) {
      // Only release if the schedule runtime is not also keeping the app awake.
      if (!(settings.schedule.keepAwake && settings.schedule.enabled && hasEnabledScheduledTask(settings))) {
        this.stopPowerSaveBlocker()
      }
      return
    }
    if (this.isPowerSaveBlockerActive()) return
    const blocker = this.deps.powerSaveBlocker
    if (!blocker) return
    this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('workflow-power-save', 'Failed to stop power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private isPowerSaveBlockerActive(): boolean {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    if (!blocker || id == null) return false
    try {
      return blocker.isStarted(id)
    } catch {
      return false
    }
  }
}

export function createWorkflowRuntime(deps: ScheduleRuntimeDeps): WorkflowRuntime {
  return new WorkflowRuntime(deps)
}
