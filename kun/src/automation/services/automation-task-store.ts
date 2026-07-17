import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AutomationTask,
  AutomationApproval,
  ExecutionLog,
  AutomationMetrics,
  AutomationTaskFilter,
  AutomationApprovalFilter,
  AutomationLogFilter
} from '../contracts/automation-types.js'

const MAX_STORED_TASKS = 1_000
const MAX_STORED_APPROVALS = 1_000
const DEFAULT_LIST_LIMIT = 200

type StoreClock = () => string

export class AutomationTaskStore {
  private readonly rootDir: string
  private readonly tasksPath: string
  private readonly approvalsPath: string
  private readonly logsPath: string
  private readonly metricsPath: string
  private readonly now: StoreClock
  private initialized = false

  constructor(userDataDir: string, options: { now?: StoreClock } = {}) {
    this.rootDir = join(userDataDir, 'automation')
    this.tasksPath = join(this.rootDir, 'tasks.json')
    this.approvalsPath = join(this.rootDir, 'approvals.json')
    this.logsPath = join(this.rootDir, 'logs.jsonl')
    this.metricsPath = join(this.rootDir, 'metrics.json')
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private async ensureReady(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.rootDir, { recursive: true })
    this.initialized = true
  }

  // ─── Tasks ───

  async listTasks(filter: AutomationTaskFilter = {}): Promise<AutomationTask[]> {
    const tasks = await this.readTasks()
    return paginate(
      tasks
        .filter((t) => matchesValue(t.employeeId, filter.employeeId))
        .filter((t) => matchesOneOf(t.status, filter.status))
        .filter((t) => matchesOneOf(t.source, filter.source))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      filter.limit,
      filter.offset
    )
  }

  async getTask(taskId: string): Promise<AutomationTask | undefined> {
    const id = taskId.trim()
    if (!id) return undefined
    return (await this.readTasks()).find((t) => t.id === id)
  }

  async putTask(task: AutomationTask): Promise<AutomationTask> {
    await this.ensureReady()
    const tasks = await this.readTasks()
    const index = tasks.findIndex((t) => t.id === task.id)
    const next = index >= 0
      ? tasks.map((t) => (t.id === task.id ? task : t))
      : [task, ...tasks]
    const trimmed = next
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_STORED_TASKS)
    await writeJson(this.tasksPath, trimmed)
    await this.recomputeMetrics(trimmed)
    return task
  }

  async updateTask(
    taskId: string,
    updater: Partial<AutomationTask> | ((task: AutomationTask) => AutomationTask)
  ): Promise<AutomationTask | undefined> {
    const existing = await this.getTask(taskId)
    if (!existing) return undefined

    const updated = typeof updater === 'function'
      ? updater(existing)
      : { ...existing, ...updater, updatedAt: this.now() }

    return this.putTask(updated)
  }

  // ─── Approvals ───

  async listApprovals(filter: AutomationApprovalFilter = {}): Promise<AutomationApproval[]> {
    const approvals = await this.readApprovals()
    return paginate(
      approvals
        .filter((a) => matchesValue(a.employeeId, filter.employeeId))
        .filter((a) => matchesOneOf(a.status, filter.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      filter.limit,
      filter.offset
    )
  }

  async getApproval(approvalId: string): Promise<AutomationApproval | undefined> {
    return (await this.readApprovals()).find((a) => a.id === approvalId)
  }

  async putApproval(approval: AutomationApproval): Promise<AutomationApproval> {
    await this.ensureReady()
    const approvals = await this.readApprovals()
    const index = approvals.findIndex((a) => a.id === approval.id)
    const next = index >= 0
      ? approvals.map((a) => (a.id === approval.id ? approval : a))
      : [approval, ...approvals]
    const trimmed = next
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_STORED_APPROVALS)
    await writeJson(this.approvalsPath, trimmed)
    return approval
  }

  // ─── Logs ───

  async appendLog(log: ExecutionLog): Promise<void> {
    await this.ensureReady()
    const line = JSON.stringify(log) + '\n'
    await writeFile(this.logsPath, line, { flag: 'a' })
  }

  async listLogs(filter: AutomationLogFilter = {}): Promise<ExecutionLog[]> {
    const raw = await readSafe(this.logsPath, '')
    if (!raw.trim()) return []

    const logs = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l) as ExecutionLog }
        catch { return null }
      })
      .filter((l): l is ExecutionLog => l !== null)

    return paginate(
      logs
        .filter((l) => matchesValue(l.taskId, filter.taskId))
        .filter((l) => matchesValue(l.employeeId, filter.employeeId))
        .filter((l) => matchesOneOf(l.level, filter.level))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      filter.limit,
      filter.offset
    )
  }

  // ─── Metrics ───

  async getMetrics(): Promise<AutomationMetrics> {
    const raw = await readSafe(this.metricsPath, '{}')
    try { return JSON.parse(raw) as AutomationMetrics }
    catch { return emptyMetrics() }
  }

  private async recomputeMetrics(tasks: AutomationTask[]): Promise<void> {
    const metrics: AutomationMetrics = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      cancelledTasks: tasks.filter((t) => t.status === 'cancelled').length,
      pendingApprovals: tasks.filter((t) => t.status === 'waiting_approval').length,
      totalTokensUsed: tasks.reduce((sum, t) => sum + t.tokensUsed, 0),
      avgResponseTimeMs: 0,
      lastUpdated: this.now()
    }
    await writeJson(this.metricsPath, metrics)
  }

  // ─── Internal Readers ───

  private async readTasks(): Promise<AutomationTask[]> {
    const raw = await readSafe(this.tasksPath, '[]')
    try { return JSON.parse(raw) as AutomationTask[] }
    catch { return [] }
  }

  private async readApprovals(): Promise<AutomationApproval[]> {
    const raw = await readSafe(this.approvalsPath, '[]')
    try { return JSON.parse(raw) as AutomationApproval[] }
    catch { return [] }
  }
}

// ─── Helpers ───

function matchesValue<T>(actual: T, expected: T | undefined): boolean {
  return expected === undefined || actual === expected
}

function matchesOneOf<T>(actual: T, expected: T[] | undefined): boolean {
  return !expected || expected.length === 0 || expected.includes(actual)
}

function paginate<T>(items: T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0
  const end = start + (limit ?? DEFAULT_LIST_LIMIT)
  return items.slice(start, end)
}

async function readSafe(path: string, fallback: string): Promise<string> {
  try { return await readFile(path, 'utf-8') }
  catch { return fallback }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

function emptyMetrics(): AutomationMetrics {
  return {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    pendingApprovals: 0,
    totalTokensUsed: 0,
    avgResponseTimeMs: 0
  }
}
