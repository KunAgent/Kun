/**
 * [INPUT]: 依赖 ResearchRun/Task、ResearchTaskWorker、EvidenceStore 与 ResearchEventInput
 * [OUTPUT]: 对外提供携带 run 模型选择、当前时间、既有来源和剩余持久化 deadline 的取消/超时控制、累计成本与单次尝试安全额度分离、搜索额度与报告完成额度分池、共享 AbortSignal 并发监听保护、可回收模型预算预留、坏 claim 局部隔离、章节问题归属校验、域名/发布方来源策略终检和并行 worker batch 执行
 * [POS]: research/runtime 的执行控制层，被 ResearchRuntime 编排核心调用，重启不重置总时限，显式重试才刷新单次尝试安全额度；证据入账前局部隔离不忠实 claim，但对越权结构和来源策略继续 fail closed
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setMaxListeners } from 'node:events'
import { dropInvalidWorkerClaims, validateWorkerResult } from '../agents/ResearchTaskWorker.js'
import type { ResearchTaskWorker, WorkerResult } from '../agents/types.js'
import { throwIfResearchAborted } from '../core/abort.js'
import type { ResearchEventInput } from '../core/events.js'
import type {
  ResearchExecutionControl,
  ResearchModelCallReservation,
  ResearchModelUsageRecord,
  ResearchRun,
  ResearchTask
} from '../core/types.js'
import type { EvidenceStore } from '../evidence/EvidenceStore.js'
import { isFatalResearchTaskError } from './ResearchRuntimePolicy.js'
import { isResearchSourceCandidateAllowed } from './ResearchSourcePolicy.js'

export class ResearchExecutionController {
  private readonly executions = new Map<string, {
    controller: AbortController
    timeout: ReturnType<typeof setTimeout>
    reservations: Map<string, { reservation: ResearchModelCallReservation; usageRecorded: boolean }>
    reservationSequence: number
  }>()

  start(
    run: ResearchRun,
    record: (event: ResearchEventInput) => Promise<void>,
    remainingTimeoutMs = run.budget.timeoutMs
  ): ResearchExecutionControl {
    this.stop(run.id)
    const controller = new AbortController()
    setMaxListeners(0, controller.signal)
    const timeout = setTimeout(() => {
      controller.abort(new Error(`research_timeout: 运行总时限 ${run.budget.timeoutMs}ms 已耗尽，已停止后续搜索和模型调用。`))
    }, Math.max(1, remainingTimeoutMs))
    const state = {
      controller,
      timeout,
      reservations: new Map<string, { reservation: ResearchModelCallReservation; usageRecorded: boolean }>(),
      reservationSequence: 0
    }
    this.executions.set(run.id, state)
    const attemptBaseline = run.attemptBudgetBaseline ?? { modelCalls: 0, totalTokens: 0 }
    const attemptModelCalls = (): number => Math.max(0,
      run.modelBudgetUsage.modelCalls - attemptBaseline.modelCalls
    )
    const attemptTotalTokens = (): number => Math.max(0,
      run.modelBudgetUsage.totalTokens - attemptBaseline.totalTokens
    )
    const synthesisCompletionCallReserve = (): number => {
      if (run.budget.preset === 'quick') return 3
      const sectionCount = Math.max(1,
        run.reportContract?.requiredSections.filter((section) => section.required).length
          ?? run.frame.coreQuestions.filter((question) => question.required || question.priority === 'high').length
      )
      return Math.min(run.budget.maxModelCalls, 1 + sectionCount + 1 + 1)
    }
    const synthesisCompletionTokenReserve = (): number => {
      if (run.budget.preset === 'quick') return 12_000
      const sectionCount = Math.max(1,
        run.reportContract?.requiredSections.filter((section) => section.required).length
          ?? run.frame.coreQuestions.filter((question) => question.required || question.priority === 'high').length
      )
      return Math.min(run.budget.maxTotalTokens, 12_000 + sectionCount * 5_000)
    }
    const isCompletionStage = (stage: ResearchModelUsageRecord['stage'] | undefined): boolean =>
      stage === 'writer' || stage === 'editor' || stage === 'judge'
    const remainingTokenBudget = (stage?: ResearchModelUsageRecord['stage']): number => Math.max(0,
      run.budget.maxTotalTokens + (isCompletionStage(stage) ? synthesisCompletionTokenReserve() : 0) -
      attemptTotalTokens() -
      [...state.reservations.values()].reduce((sum, item) => sum + item.reservation.estimatedTokens, 0)
    )
    const remainingModelCalls = (stage?: ResearchModelUsageRecord['stage']): number => Math.max(0,
      run.budget.maxModelCalls + (isCompletionStage(stage) ? synthesisCompletionCallReserve() : 0) - attemptModelCalls()
    )
    const canReserveModelCall = (stage: ResearchModelUsageRecord['stage'], estimatedTokens = 1): boolean => {
      const callsAfterReservation = remainingModelCalls(stage) - 1
      if (callsAfterReservation < 0) return false
      const researchStage = stage === 'web_search' || stage === 'web_extraction'
      if (researchStage && callsAfterReservation < synthesisCompletionCallReserve()) return false
      if (researchStage && remainingTokenBudget() - Math.max(1, Math.floor(estimatedTokens)) < synthesisCompletionTokenReserve()) return false
      return Math.max(1, Math.floor(estimatedTokens)) <= remainingTokenBudget(stage)
    }
    const control: ResearchExecutionControl = {
      signal: controller.signal,
      ...(run.model?.trim() ? { model: run.model.trim() } : {}),
      ...(run.providerId?.trim() ? { providerId: run.providerId.trim() } : {}),
      canReserveModelCall,
      reserveModelCall: (stage, estimatedTokens = 1) => {
        throwIfResearchAborted(controller.signal)
        run.modelBudgetUsage ??= emptyModelBudgetUsage()
        if (!canReserveModelCall(stage, estimatedTokens)) {
          if ((stage === 'web_search' || stage === 'web_extraction') && remainingModelCalls() > 0) {
            throw new Error(`research_model_call_budget_reserved: ${stage} 已停止，剩余 ${remainingModelCalls()} 次调用为证据抽取、写作、编辑和 Judge 保留。`)
          }
        }
        if (remainingModelCalls(stage) <= 0) {
          const limit = run.budget.maxModelCalls + (isCompletionStage(stage) ? synthesisCompletionCallReserve() : 0)
          throw new Error(`research_model_call_budget_exhausted: ${stage} 调用前已达到 ${limit} 次模型调用上限。`)
        }
        const normalizedEstimate = Math.max(1, Math.floor(estimatedTokens))
        const available = remainingTokenBudget(stage)
        if (normalizedEstimate > available) {
          throw new Error(`research_token_budget_exhausted: ${stage} 调用预计需要 ${normalizedEstimate} tokens，但本次只剩 ${available} tokens。`)
        }
        run.modelBudgetUsage.modelCalls += 1
        state.reservationSequence += 1
        const reservation: ResearchModelCallReservation = {
          id: `${run.id}_${stage}_${state.reservationSequence}`,
          stage,
          estimatedTokens: normalizedEstimate
        }
        state.reservations.set(reservation.id, { reservation, usageRecorded: false })
        return reservation
      },
      recordModelUsage: async (usageRecord, reservation) => {
        if (reservation) {
          const reserved = state.reservations.get(reservation.id)
          if (reserved?.usageRecorded) return
          if (reserved) reserved.usageRecorded = true
        }
        await recordResearchModelUsage({ run, records: [usageRecord], record })
      },
      finishModelCall: async (reservation, options = {}) => {
        const reserved = state.reservations.get(reservation.id)
        if (!reserved) return
        state.reservations.delete(reservation.id)
        if (!reserved.usageRecorded && options.chargeEstimateOnMissing) {
          await recordResearchModelUsage({
            run,
            records: [{
              stage: reservation.stage,
              model: 'usage-unreported',
              turnId: reservation.id,
              estimated: true,
              usage: {
                promptTokens: reservation.estimatedTokens,
                completionTokens: 0,
                totalTokens: reservation.estimatedTokens,
                cacheHitRate: null,
                turns: 1,
                hasError: true
              }
            }],
            record
          })
        }
      },
      releaseModelCall: async (reservation) => {
        const reserved = state.reservations.get(reservation.id)
        if (!reserved) return
        state.reservations.delete(reservation.id)
        if (!reserved.usageRecorded) {
          run.modelBudgetUsage.modelCalls = Math.max(0, run.modelBudgetUsage.modelCalls - 1)
        }
      },
      remainingTokenBudget,
      remainingModelCalls,
      recordWebAudit: async (audit) => {
        const recordValue = {
          ...audit,
          id: `${run.id}_web_audit_${(run.webAudit?.length ?? 0) + 1}`,
          recordedAt: new Date().toISOString()
        }
        run.webAudit = [...(run.webAudit ?? []), recordValue].slice(-200)
        await record({ type: 'WEB_AUDIT_RECORDED', record: recordValue })
      }
    }
    return control
  }

  cancel(runId: string, reason?: string): void {
    this.executions.get(runId)?.controller.abort(new Error(reason || 'research run cancelled by user'))
  }

  stop(runId: string): void {
    const state = this.executions.get(runId)
    if (!state) return
    if (!state.controller.signal.aborted) state.controller.abort(new Error('research execution stopped'))
    clearTimeout(state.timeout)
    this.executions.delete(runId)
  }
}

export async function recordResearchModelUsage(input: {
  run: ResearchRun
  records?: ResearchModelUsageRecord[]
  record: (event: ResearchEventInput) => Promise<void>
}): Promise<void> {
  for (const record of input.records ?? []) {
    input.run.modelBudgetUsage ??= emptyModelBudgetUsage()
    input.run.modelBudgetUsage.totalTokens += record.usage.totalTokens
    input.run.modelBudgetUsage.costUsd += record.usage.costUsd ?? 0
    input.run.modelBudgetUsage.costCny += record.usage.costCny ?? 0
    await input.record({ type: 'MODEL_USAGE_RECORDED', record })
    const attemptTokens = input.run.modelBudgetUsage.totalTokens - (input.run.attemptBudgetBaseline?.totalTokens ?? 0)
    if (attemptTokens > input.run.budget.maxTotalTokens) {
      throw new Error(`research_token_budget_exhausted: 本次尝试已使用 ${attemptTokens} tokens，超过安全上限 ${input.run.budget.maxTotalTokens}。`)
    }
  }
}

export async function runResearchTaskBatch(input: {
  run: ResearchRun
  tasks: ResearchTask[]
  evidenceStore: EvidenceStore
  execution: ResearchExecutionControl
  worker: ResearchTaskWorker
  record: (event: ResearchEventInput) => Promise<void>
  recordModelUsage: (records?: ResearchModelUsageRecord[]) => Promise<void>
}): Promise<void> {
  const concurrency = Math.max(1, Math.min(
    Math.floor(input.run.budget.maxWorkers || 1),
    Math.floor(input.worker.recommendedConcurrency?.() ?? input.run.budget.maxWorkers)
  ))
  for (let offset = 0; offset < input.tasks.length; offset += concurrency) {
    const batch = input.tasks.slice(offset, offset + concurrency)
    for (const task of batch) {
      task.status = 'running'
      await input.record({ type: 'TASK_STARTED', taskId: task.id })
    }

    const workerResults = await Promise.allSettled(batch.map(async (task) => {
      throwIfResearchAborted(input.execution.signal)
      const result = await input.worker.runTask({
        runId: input.run.id,
        nowIso: input.run.updatedAt,
        task,
        brief: input.run.brief,
        frame: input.run.frame,
        budget: input.run.budget,
        existingSourceUrls: input.evidenceStore.listSources()
          .flatMap((source) => [source.canonicalUrl, source.originalUrl])
          .filter((url): url is string => Boolean(url)),
        execution: input.execution
      })
      return { task, result }
    }))
    throwIfResearchAborted(input.execution.signal)
    const fatalFailure = workerResults.find((result) =>
      result.status === 'rejected' && isFatalResearchTaskError(result.reason)
    )
    if (fatalFailure?.status === 'rejected') throw fatalFailure.reason

    for (let index = 0; index < workerResults.length; index += 1) {
      const task = batch[index]
      const settled = workerResults[index]
      if (!task || !settled) continue
      if (settled.status === 'rejected') {
        task.status = 'failed'
        await input.record({
          type: 'TASK_FAILED',
          taskId: task.id,
          reason: settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        })
        continue
      }

      const sanitized = dropInvalidWorkerClaims(settled.value.result)
      validateWorkerResult(sanitized)
      const result = input.evidenceStore.canonicalizeWorkerResult(sanitized)
      validateWorkerResultPolicy(input.run, task, result, input.evidenceStore.listSources().length)
      await input.evidenceStore.recordWorkerResult(result)
      await input.recordModelUsage(result.modelUsage)
      task.status = 'done'
      for (const source of result.sources) {
        await input.record({ type: 'SOURCE_ADDED', sourceId: source.id })
      }
      for (const note of result.notes) {
        await input.record({ type: 'NOTE_ADDED', noteId: note.id })
      }
      await input.record({ type: 'TASK_COMPLETED', taskId: task.id })
      await input.record({
        type: 'WORKER_RESULT_RECORDED',
        taskId: task.id,
        sourceCount: result.sources.length,
        evidenceSpanCount: result.evidenceSpans.length,
        claimCount: result.claims.length,
        noteCount: result.notes.length
      })
    }
  }
}

function validateWorkerResultPolicy(
  run: ResearchRun,
  task: ResearchTask,
  result: WorkerResult,
  existingSourceCount: number
): void {
  if (result.taskId !== task.id) {
    throw new Error(`Worker result taskId ${result.taskId} does not match runtime task ${task.id}`)
  }
  const allowedSourceTypes = new Set(run.brief.sourcePolicy.allowedSourceTypes)
  for (const source of result.sources) {
    if (!allowedSourceTypes.has(source.sourceType)) {
      throw new Error(`Source ${source.id} uses disallowed source type ${source.sourceType}`)
    }
    const sourceUrl = source.canonicalUrl ?? source.originalUrl
    if (source.sourceType === 'web' && !isResearchSourceCandidateAllowed(run.brief.sourcePolicy, {
      url: sourceUrl,
      title: source.title,
      publisher: source.publisher
    })) {
      throw new Error(`Source ${source.id} violates allowed source identity policy: ${sourceUrl ?? source.title}`)
    }
  }
  if (result.sources.length > task.maxSources) {
    throw new Error(`Worker result for ${task.id} returned ${result.sources.length} sources, exceeding task limit ${task.maxSources}`)
  }
  if (existingSourceCount + result.sources.length > run.budget.maxSources) {
    throw new Error(`Research run ${run.id} exceeded source budget ${run.budget.maxSources}`)
  }
  const taskQuestionIds = new Set(task.questionIds)
  for (const questionId of result.questionIds) {
    if (!taskQuestionIds.has(questionId)) {
      throw new Error(`Worker result ${result.taskId} references question ${questionId} outside task scope`)
    }
  }
  const explicitReportQuestionIds = (task.reportQuestionIds ?? [])
    .filter((questionId) => taskQuestionIds.has(questionId))
  const legacyReportQuestionIds = explicitReportQuestionIds.length === 0
    ? (task.reportSectionIds ?? []).filter((questionId) => taskQuestionIds.has(questionId))
    : []
  const reportQuestionIds = new Set(explicitReportQuestionIds.length > 0 ? explicitReportQuestionIds : legacyReportQuestionIds)
  const ownedQuestionIds = reportQuestionIds.size > 0 ? reportQuestionIds : taskQuestionIds
  for (const note of result.notes) {
    for (const questionId of note.questionIds) {
      if (!ownedQuestionIds.has(questionId)) {
        throw new Error(`Worker note ${note.id} assigns evidence to question ${questionId} outside task ownership`)
      }
    }
  }
}

function emptyModelBudgetUsage(): ResearchRun['modelBudgetUsage'] {
  return { modelCalls: 0, totalTokens: 0, costUsd: 0, costCny: 0 }
}
