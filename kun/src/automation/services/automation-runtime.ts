import { randomUUID } from 'node:crypto'
import type {
  DigitalEmployee,
  AutomationTask,
  AutomationApproval,
  ExecutionLog,
  AutomationTaskFilter,
  AutomationApprovalFilter,
  AutomationLogFilter,
  AutomationSettings,
  RiskAssessment
} from '../contracts/automation-types.js'
import { AutomationPolicyEngine, type PolicyDecision } from './automation-policy-engine.js'
import { AutomationTaskStore } from './automation-task-store.js'
import type { AutomationExecutor } from './automation-executor.js'
import type { AutomationDeliveryAdapter } from './automation-delivery.js'

/**
 * Automation Runtime
 *
 * Orchestrates digital employee task execution:
 * - Creates tasks and evaluates policy
 * - Routes to Kun runtime for LLM inference
 * - Manages approval workflow
 * - Persists tasks, approvals, and logs
 */

export type AutomationRuntimeDeps = {
  taskStore: AutomationTaskStore
  policyEngine?: AutomationPolicyEngine
  deliveryAdapter?: AutomationDeliveryAdapter
  /**
   * In-process executor bridging to Kun's thread/turn services. Preferred over
   * the legacy HTTP self-call. When absent, task execution fails fast with a
   * clear message instead of a placeholder throw.
   */
  executor?: AutomationExecutor
  /** Legacy HTTP proxy (deprecated). Only used when `executor` is not provided. */
  kunRuntimeRequest?: KunRuntimeRequestFn
  logError?: (category: string, message: string, detail?: unknown) => void
  now?: () => string
}

export type KunRuntimeRequestFn = (
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; body: string }>

export type RunTaskInput = {
  employeeId: string
  source: AutomationTask['source']
  inputText: string
  prompt?: string
  actionLevel?: AutomationTask['actionLevel']
  sourceMetadata?: Record<string, unknown>
}

export type RunTaskResult = {
  taskId: string
  status: AutomationTask['status']
  decision: PolicyDecision
}

export type ApprovalDecisionInput = {
  editedOutput?: string
  note?: string
}

export class AutomationRuntime {
  private deps: AutomationRuntimeDeps
  private readonly policyEngine: AutomationPolicyEngine
  private settings: AutomationSettings | null = null
  private cancelledTaskIds = new Set<string>()
  private readonly abortControllers = new Map<string, AbortController>()

  constructor(deps: AutomationRuntimeDeps) {
    this.deps = deps
    this.policyEngine = deps.policyEngine ?? new AutomationPolicyEngine()
  }

  sync(settings: AutomationSettings): void {
    this.settings = settings
  }

  /**
   * Attach the in-process executor after construction. Used by the feature
   * seam, which only has the real ServerRuntime (with threadService/turnService/
   * runTurn) inside registerRoutes(), not during initializeServices().
   */
  setExecutor(executor: AutomationExecutor): void {
    this.deps = { ...this.deps, executor }
  }

  isEnabled(): boolean {
    return this.settings?.enabled === true
  }

  // ─── Task Execution ───

  async runTask(input: RunTaskInput): Promise<RunTaskResult> {
    const employee = this.getEmployee(input.employeeId)
    if (!employee) {
      throw new Error(`Digital employee not found: ${input.employeeId}`)
    }

    const now = this.now()
    const task: AutomationTask = {
      id: randomUUID(),
      employeeId: input.employeeId,
      source: input.source,
      status: 'pending',
      actionLevel: input.actionLevel ?? employee.autoReplyPolicy.actionLevel,
      inputText: input.inputText,
      outputText: '',
      prompt: input.prompt ?? '',
      sourceMetadata: input.sourceMetadata,
      tokensUsed: 0,
      toolCallCount: 0,
      createdAt: now,
      updatedAt: now
    }

    await this.deps.taskStore.putTask(task)
    await this.logInfo(task.id, employee.id, 'Task created', { source: input.source })

    // Check if task is cancelled before execution
    if (this.cancelledTaskIds.has(task.id)) {
      task.status = 'cancelled'
      task.updatedAt = this.now()
      await this.deps.taskStore.putTask(task)
      return { taskId: task.id, status: 'cancelled', decision: { kind: 'draft', risk: emptyRisk() } }
    }

    // Execute with Kun runtime
    try {
      task.status = 'running'
      task.updatedAt = this.now()
      await this.deps.taskStore.putTask(task)

      const output = await this.executeWithKun(employee, task)
      task.outputText = output.text
      task.threadId = output.threadId
      task.turnId = output.turnId
      task.tokensUsed = output.tokensUsed
      task.toolCallCount = output.toolCallCount

      // Evaluate policy
      const decision = this.policyEngine.evaluate({
        employee,
        task,
        proposedOutput: task.outputText,
        sourceMetadata: input.sourceMetadata,
        recentTasks: await this.deps.taskStore.listTasks({ employeeId: employee.id, limit: 100 }),
        now: new Date()
      })

      task.risk = decision.risk

      if (decision.kind === 'block') {
        task.status = 'failed'
        task.error = decision.message
        await this.logError(task.id, employee.id, 'Task blocked by policy', { message: decision.message })
      } else if (decision.kind === 'request_approval') {
        task.status = 'waiting_approval'
        await this.createApproval(task, employee, decision.risk)
        await this.logInfo(task.id, employee.id, 'Approval requested', { risk: decision.risk.level })
      } else if (decision.kind === 'send') {
        // Attempt delivery through the configured adapter
        if (this.deps.deliveryAdapter) {
          const receipt = await this.deps.deliveryAdapter.deliver({
            employee,
            task,
            output: task.outputText
          })
          if (receipt.delivered) {
            task.status = 'completed'
            task.completedAt = this.now()
            await this.logInfo(task.id, employee.id, 'Task completed and delivered', {
              tokensUsed: task.tokensUsed,
              channel: receipt.channel
            })
          } else {
            // Delivery failed, downgrade to draft
            task.status = 'completed'
            task.completedAt = this.now()
            await this.logInfo(task.id, employee.id, 'Task completed as draft (delivery unavailable)', {
              tokensUsed: task.tokensUsed,
              reason: receipt.detail
            })
          }
        } else {
          // No adapter, treat as draft
          task.status = 'completed'
          task.completedAt = this.now()
          await this.logInfo(task.id, employee.id, 'Task completed as draft (no delivery adapter)', {
            tokensUsed: task.tokensUsed
          })
        }
      } else {
        task.status = 'completed'
        task.completedAt = this.now()
        await this.logInfo(task.id, employee.id, 'Task completed as draft', { tokensUsed: task.tokensUsed })
      }

      task.updatedAt = this.now()
      await this.deps.taskStore.putTask(task)

      return { taskId: task.id, status: task.status, decision }
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.updatedAt = this.now()
      await this.deps.taskStore.putTask(task)
      await this.logError(task.id, employee.id, 'Task execution failed', { error: task.error })
      throw error
    }
  }

  // ─── Approval Management ───

  async approveTask(approvalId: string, input?: ApprovalDecisionInput): Promise<AutomationTask> {
    const approval = await this.deps.taskStore.getApproval(approvalId)
    if (!approval) throw new Error(`Approval not found: ${approvalId}`)
    if (approval.status !== 'pending') throw new Error(`Approval already resolved: ${approval.status}`)

    const task = await this.deps.taskStore.getTask(approval.taskId)
    if (!task) throw new Error(`Task not found: ${approval.taskId}`)

    const now = this.now()
    approval.status = 'approved'
    approval.resolvedAt = now
    if (input?.editedOutput) {
      approval.approverEditedOutput = input.editedOutput
      task.outputText = input.editedOutput
    }
    if (input?.note) {
      approval.decisionNote = input.note
    }

    task.status = 'completed'
    task.completedAt = now
    task.updatedAt = now

    await this.deps.taskStore.putApproval(approval)
    await this.deps.taskStore.putTask(task)
    await this.logInfo(task.id, task.employeeId, 'Task approved', { approvalId })

    return task
  }

  async rejectTask(approvalId: string, input?: ApprovalDecisionInput): Promise<AutomationTask> {
    const approval = await this.deps.taskStore.getApproval(approvalId)
    if (!approval) throw new Error(`Approval not found: ${approvalId}`)
    if (approval.status !== 'pending') throw new Error(`Approval already resolved: ${approval.status}`)

    const task = await this.deps.taskStore.getTask(approval.taskId)
    if (!task) throw new Error(`Task not found: ${approval.taskId}`)

    const now = this.now()
    approval.status = 'rejected'
    approval.resolvedAt = now
    if (input?.note) {
      approval.decisionNote = input.note
    }

    task.status = 'cancelled'
    task.updatedAt = now

    await this.deps.taskStore.putApproval(approval)
    await this.deps.taskStore.putTask(task)
    await this.logInfo(task.id, task.employeeId, 'Task rejected', { approvalId })

    return task
  }

  async cancelTask(taskId: string): Promise<AutomationTask> {
    this.cancelledTaskIds.add(taskId)
    // Abort the in-flight turn if one is running.
    this.abortControllers.get(taskId)?.abort()

    const task = await this.deps.taskStore.getTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    if (task.status === 'pending' || task.status === 'running') {
      task.status = 'cancelled'
      task.updatedAt = this.now()
      await this.deps.taskStore.putTask(task)
      await this.logInfo(task.id, task.employeeId, 'Task cancelled')
    }

    return task
  }

  // ─── Query Methods ───

  async listTasks(filter?: AutomationTaskFilter): Promise<AutomationTask[]> {
    return this.deps.taskStore.listTasks(filter)
  }

  async getTask(taskId: string): Promise<AutomationTask | undefined> {
    return this.deps.taskStore.getTask(taskId)
  }

  async listApprovals(filter?: AutomationApprovalFilter): Promise<AutomationApproval[]> {
    return this.deps.taskStore.listApprovals(filter)
  }

  async listLogs(filter?: AutomationLogFilter): Promise<ExecutionLog[]> {
    return this.deps.taskStore.listLogs(filter)
  }

  // ─── Internal Helpers ───

  private async createApproval(
    task: AutomationTask,
    employee: DigitalEmployee,
    risk: AutomationTask['risk']
  ): Promise<void> {
    const now = this.now()
    const timeoutMs = employee.approvalPolicy.timeoutMinutes * 60 * 1000
    const expiresAt = new Date(Date.parse(now) + timeoutMs).toISOString()

    const approval: AutomationApproval = {
      id: randomUUID(),
      taskId: task.id,
      employeeId: employee.id,
      status: 'pending',
      riskLevel: risk?.level ?? 'low',
      proposedOutput: task.outputText,
      createdAt: now,
      expiresAt
    }

    await this.deps.taskStore.putApproval(approval)
  }

  private async executeWithKun(
    employee: DigitalEmployee,
    task: AutomationTask
  ): Promise<{ text: string; threadId: string; turnId: string; tokensUsed: number; toolCallCount: number }> {
    const systemPrompt = buildSystemPrompt(employee, task)
    const controller = new AbortController()
    this.abortControllers.set(task.id, controller)

    try {
      // Preferred: in-process executor bridging to Kun's thread/turn services.
      if (this.deps.executor) {
        return await this.deps.executor.execute({
          systemPrompt,
          expertId: employee.expertAssignment.expertId || undefined,
          inputText: task.inputText,
          title: `[Automation] ${employee.name} - ${task.source}`,
          signal: controller.signal
        })
      }

      // Legacy fallback: HTTP self-call (deprecated).
      if (this.deps.kunRuntimeRequest) {
        return await this.executeViaHttp(employee, task, systemPrompt)
      }

      throw new Error('Automation executor not configured (no in-process executor or HTTP proxy)')
    } finally {
      this.abortControllers.delete(task.id)
    }
  }

  private async executeViaHttp(
    employee: DigitalEmployee,
    task: AutomationTask,
    systemPrompt: string
  ): Promise<{ text: string; threadId: string; turnId: string; tokensUsed: number; toolCallCount: number }> {
    const kunRuntimeRequest = this.deps.kunRuntimeRequest!
    const createBody = {
      title: `[Automation] ${employee.name} - ${task.source}`,
      mode: 'agent',
      systemPrompt,
      expertId: employee.expertAssignment.expertId || undefined
    }

    const createRes = await kunRuntimeRequest('/v1/threads', {
      method: 'POST',
      body: JSON.stringify(createBody)
    })
    if (!createRes.ok) throw new Error(`Failed to create thread: ${createRes.status}`)
    const thread = JSON.parse(createRes.body) as { id: string }
    const threadId = thread.id

    const turnBody = { messages: [{ role: 'user', content: task.inputText }] }
    const turnRes = await kunRuntimeRequest(`/v1/threads/${threadId}/turns`, {
      method: 'POST',
      body: JSON.stringify(turnBody)
    })
    if (!turnRes.ok) throw new Error(`Failed to send turn: ${turnRes.status}`)
    const turn = JSON.parse(turnRes.body) as { id: string }
    const turnId = turn.id

    let attempts = 0
    const maxAttempts = 120
    while (attempts < maxAttempts) {
      await sleep(1500)
      const detailRes = await kunRuntimeRequest(`/v1/threads/${threadId}`, { method: 'GET' })
      if (!detailRes.ok) throw new Error(`Failed to fetch thread: ${detailRes.status}`)

      const detail = JSON.parse(detailRes.body) as {
        turns?: Array<{ id: string; status?: string; items?: Array<{ kind?: string; text?: string }> }>
      }
      const targetTurn = detail.turns?.find((t) => t.id === turnId)
      if (targetTurn?.status === 'completed') {
        const assistantItem = targetTurn.items?.find((i) => i.kind === 'assistant_text')
        return { text: assistantItem?.text || '', threadId, turnId, tokensUsed: 0, toolCallCount: 0 }
      }
      if (targetTurn?.status === 'error') {
        throw new Error('Turn execution failed')
      }
      attempts++
    }

    throw new Error('Task execution timeout')
  }

  private getEmployee(employeeId: string): DigitalEmployee | undefined {
    return this.settings?.employees.find((e) => e.id === employeeId)
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString()
  }

  private async logInfo(taskId: string, employeeId: string, message: string, detail?: Record<string, unknown>): Promise<void> {
    await this.deps.taskStore.appendLog({
      id: randomUUID(),
      taskId,
      employeeId,
      timestamp: this.now(),
      level: 'info',
      category: 'automation',
      message,
      detail
    })
  }

  private async logError(taskId: string, employeeId: string, message: string, detail?: Record<string, unknown>): Promise<void> {
    await this.deps.taskStore.appendLog({
      id: randomUUID(),
      taskId,
      employeeId,
      timestamp: this.now(),
      level: 'error',
      category: 'automation',
      message,
      detail
    })
    if (this.deps.logError) {
      this.deps.logError('automation', message, detail)
    }
  }
}

function buildSystemPrompt(employee: DigitalEmployee, task: AutomationTask): string {
  const parts: string[] = []

  if (employee.profile.roleDescription) {
    parts.push(`Role: ${employee.profile.roleDescription}`)
  }
  if (employee.profile.workBoundary) {
    parts.push(`Work Boundary: ${employee.profile.workBoundary}`)
  }
  if (employee.profile.tone) {
    parts.push(`Tone: ${employee.profile.tone}`)
  }
  if (employee.profile.defaultDeliverableFormat) {
    parts.push(`Format: ${employee.profile.defaultDeliverableFormat}`)
  }
  if (task.prompt) {
    parts.push(`\nTask: ${task.prompt}`)
  }

  return parts.join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function emptyRisk(): RiskAssessment {
  return {
    level: 'low',
    reasons: [],
    matchedRules: [],
    requiresApproval: false,
    policyDecision: 'draft'
  }
}
