/**
 * [INPUT]: 依赖 adapters/file/atomic-write、research core types 和 evidence types 的落盘契约
 * [OUTPUT]: 对外提供 ResearchRunRepository，负责 run 布局、JSONL ledger、按最后终态或失败/取消后的重试事件恢复、Markdown 产物和证据写入
 * [POS]: research/storage 的文件系统仓库，被 ResearchRuntime 用于持久化用户可见报告和稳定机器可读产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import { slugify } from '../core/hash.js'
import type { ResearchEvent } from '../core/events.js'
import type { ResearchArtifactPaths, ResearchRun } from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceLedgerEntry } from '../evidence/types.js'

export type ResearchRunLayout = ResearchArtifactPaths

export type ResearchRunRepositoryOptions = {
  workspaceRoot: string
}

export type CreateRunLayoutInput = {
  runId: string
  title: string
  createdAt: string
}

export type ResearchMarkdownArtifacts = {
  reportMarkdown: string
  briefMarkdown: string
  planMarkdown: string
  sourcesMarkdown: string
  notesMarkdown: string
}

export class ResearchRunRepository {
  constructor(private readonly options: ResearchRunRepositoryOptions) {}

  async createRunLayout(input: CreateRunLayoutInput): Promise<ResearchRunLayout> {
    const stamp = input.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
    const titleSegment = safePathSegment(input.title)
    const rootDir = join(this.options.workspaceRoot, 'Research', `${stamp}-${titleSegment}-${input.runId.slice(0, 8)}`)
    const machineDir = join(rootDir, '.kun-research')
    await mkdir(machineDir, { recursive: true })
    const layout = {
      rootDir,
      reportPath: join(rootDir, `${titleSegment}.md`),
      briefPath: join(rootDir, 'brief.md'),
      planPath: join(rootDir, 'plan.md'),
      sourcesPath: join(rootDir, 'sources.md'),
      notesPath: join(rootDir, 'notes.md'),
      machineDir,
      runJsonPath: join(machineDir, 'run.json'),
      evidenceJsonlPath: join(machineDir, 'evidence.jsonl'),
      claimsJsonlPath: join(machineDir, 'claims.jsonl'),
      citationsJsonlPath: join(machineDir, 'citations.jsonl'),
      eventsJsonlPath: join(machineDir, 'events.jsonl')
    }
    await Promise.all([
      appendFile(layout.evidenceJsonlPath, ''),
      appendFile(layout.claimsJsonlPath, ''),
      appendFile(layout.citationsJsonlPath, ''),
      appendFile(layout.eventsJsonlPath, '')
    ])
    return layout
  }

  reportPathForTitle(layout: ResearchRunLayout, title: string): string {
    return join(layout.rootDir, researchReportFileName(title))
  }

  async writeRun(run: ResearchRun): Promise<void> {
    await atomicWriteFile(run.artifacts.runJsonPath, `${JSON.stringify(run, null, 2)}\n`)
  }

  async loadRuns(): Promise<ResearchRun[]> {
    const researchRoot = join(this.options.workspaceRoot, 'Research')
    const entries = await readdir(researchRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const runs: ResearchRun[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const runPath = join(researchRoot, entry.name, '.kun-research', 'run.json')
      const raw = await readFile(runPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
      if (!raw.trim()) continue
      try {
        const run = JSON.parse(raw) as ResearchRun
        runs.push(await this.recoverRunState(run))
      } catch {
        // A corrupt run is isolated; other persisted runs remain available.
      }
    }
    return runs
  }

  private async recoverRunState(run: ResearchRun): Promise<ResearchRun> {
    const events = await this.readJsonl<ResearchEvent>(run.artifacts.eventsJsonlPath)
    const planFromEvents = events
      .filter((event): event is Extract<ResearchEvent, { type: 'PLAN_CREATED' }> => event.type === 'PLAN_CREATED' && Boolean(event.plan))
      .at(-1)?.plan
    run.plan ??= planFromEvents
    if (run.plan) {
      const taskById = new Map(run.plan.tasks.map((task) => [task.id, task]))
      for (const event of events) {
        if (event.type === 'FOLLOW_UP_TASK_CREATED' && !taskById.has(event.task.id)) {
          run.plan.tasks.push(event.task)
          taskById.set(event.task.id, event.task)
        }
        if (event.type === 'TASK_STARTED') {
          const task = taskById.get(event.taskId)
          if (task) task.status = 'running'
        }
        if (event.type === 'TASK_COMPLETED') {
          const task = taskById.get(event.taskId)
          if (task) task.status = 'done'
        }
        if (event.type === 'TASK_FAILED') {
          const task = taskById.get(event.taskId)
          if (task) task.status = 'failed'
        }
      }
      for (const task of run.plan.tasks) {
        if (task.status === 'running') task.status = 'pending'
      }
    }
    const gapVerdicts = events
      .filter((event): event is Extract<ResearchEvent, { type: 'GAP_CHECK_COMPLETED' }> => event.type === 'GAP_CHECK_COMPLETED')
      .map((event) => event.verdict)
    if (gapVerdicts.length > 0) run.gapVerdicts = dedupeById(gapVerdicts)
    const convergenceVerdicts = events
      .filter((event): event is Extract<ResearchEvent, { type: 'CONVERGENCE_ANALYZED' }> => event.type === 'CONVERGENCE_ANALYZED')
      .map((event) => event.verdict)
    if (convergenceVerdicts.length > 0) run.convergenceVerdicts = dedupeById(convergenceVerdicts)
    const latestVerification = events
      .filter((event): event is Extract<ResearchEvent, { type: 'VERIFICATION_COMPLETED' }> => event.type === 'VERIFICATION_COMPLETED')
      .at(-1)?.verdict
    if (latestVerification) run.verification = latestVerification
    const usageRecords = events
      .filter((event): event is Extract<ResearchEvent, { type: 'MODEL_USAGE_RECORDED' }> => event.type === 'MODEL_USAGE_RECORDED')
      .map((event) => event.record)
    if (usageRecords.length > 0) {
      run.modelBudgetUsage = {
        modelCalls: Math.max(run.modelBudgetUsage?.modelCalls ?? 0, usageRecords.length),
        totalTokens: usageRecords.reduce((sum, record) => sum + record.usage.totalTokens, 0),
        costUsd: usageRecords.reduce((sum, record) => sum + (record.usage.costUsd ?? 0), 0),
        costCny: usageRecords.reduce((sum, record) => sum + (record.usage.costCny ?? 0), 0)
      }
    }
    const webAudit = events
      .filter((event): event is Extract<ResearchEvent, { type: 'WEB_AUDIT_RECORDED' }> => event.type === 'WEB_AUDIT_RECORDED')
      .map((event) => event.record)
    if (webAudit.length > 0) run.webAudit = webAudit.slice(-200)
    const lastEvent = events.at(-1)
    if (lastEvent) run.updatedAt = lastEvent.timestamp
    const terminalEvent = [...events].reverse().find((event) =>
      event.type === 'REPORT_WRITTEN' ||
      event.type === 'RUN_RETRIED' ||
      event.type === 'RUN_CANCELLED' ||
      event.type === 'RESEARCH_UNAVAILABLE' ||
      event.type === 'RUN_FAILED'
    )
    if (terminalEvent?.type === 'RUN_RETRIED') {
      if (run.status === 'failed' || run.status === 'cancelled') run.status = 'planning'
      delete run.terminalReason
    } else if (terminalEvent?.type === 'REPORT_WRITTEN') {
      run.status = 'done'
      delete run.terminalReason
    } else if (terminalEvent?.type === 'RUN_CANCELLED') {
      run.status = 'cancelled'
      run.terminalReason = terminalEvent.reason?.trim() || '研究任务已取消。'
    } else if (terminalEvent?.type === 'RESEARCH_UNAVAILABLE') {
      run.status = 'research_unavailable'
      run.terminalReason = terminalEvent.reason
    } else if (terminalEvent?.type === 'RUN_FAILED') {
      run.status = 'failed'
      run.terminalReason = terminalEvent.reason
    }
    if (run.status === 'failed' && !run.terminalReason && latestVerification) {
      run.terminalReason = latestVerification.blockingIssues[0]
        ?? latestVerification.llmJudge?.rationale
        ?? '报告质量校验未通过。'
    }
    return run
  }

  async appendEvent(layout: ResearchRunLayout, event: ResearchEvent): Promise<void> {
    await appendJsonl(layout.eventsJsonlPath, event)
  }

  async appendEvidenceEntry(layout: ResearchRunLayout, entry: EvidenceLedgerEntry): Promise<void> {
    await appendJsonl(layout.evidenceJsonlPath, entry)
  }

  async appendClaim(layout: ResearchRunLayout, claim: AtomicClaim): Promise<void> {
    await appendJsonl(layout.claimsJsonlPath, claim)
  }

  async appendCitation(layout: ResearchRunLayout, citation: CitationBinding): Promise<void> {
    await appendJsonl(layout.citationsJsonlPath, citation)
  }

  async writeMarkdownArtifacts(layout: ResearchRunLayout, artifacts: ResearchMarkdownArtifacts): Promise<void> {
    await Promise.all([
      atomicWriteFile(layout.reportPath, artifacts.reportMarkdown),
      atomicWriteFile(layout.briefPath, artifacts.briefMarkdown),
      atomicWriteFile(layout.planPath, artifacts.planMarkdown),
      atomicWriteFile(layout.sourcesPath, artifacts.sourcesMarkdown),
      atomicWriteFile(layout.notesPath, artifacts.notesMarkdown)
    ])
  }

  async writeReportDraft(layout: ResearchRunLayout, reportMarkdown: string): Promise<void> {
    await atomicWriteFile(join(layout.machineDir, 'report-draft.md'), reportMarkdown)
  }

  async readJsonl<T>(path: string): Promise<T[]> {
    const content = await readFile(path, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
  }
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map(values.map((value) => [value.id, value]))
  return [...byId.values()]
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf-8')
}

function safePathSegment(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const clipped = Array.from(normalized).slice(0, 80).join('').replace(/-+$/g, '')
  return clipped || slugify(value)
}

export function researchReportFileName(title: string): string {
  return `${safePathSegment(title)}.md`
}
