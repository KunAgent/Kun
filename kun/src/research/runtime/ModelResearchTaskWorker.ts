/**
 * [INPUT]: 依赖 ModelClient、携带当前模型/Provider 的 ResearchTaskWorker 输入、预算控制和 synthetic diagnostic worker
 * [OUTPUT]: 对外提供支持运行级模型选择的 ModelResearchTaskWorker、模型资料卡 prompt/parser 和不可引用 fallback 结果
 * [POS]: research/runtime 的离线资料卡 worker，仅供 quick/debug；standard/deep 不把其结果当可引用证据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { researchReasoningForStage } from '../core/presets.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import type { ResearchConfidence, ResearchModelUsageRecord, ResearchSourceType } from '../core/types.js'
import { hashText } from '../core/hash.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord, SourceReliability } from '../evidence/types.js'
import type { ConflictCandidate, ResearchTaskWorker, ResearchTaskWorkerInput, WorkerResult } from '../agents/types.js'
import { DefaultResearchTaskWorker } from './DefaultResearchTaskWorker.js'
import { isFatalResearchTaskError } from './ResearchRuntimePolicy.js'

export const MODEL_RESEARCH_TASK_WORKER_TIMEOUT_MS = 60_000

export const MODEL_RESEARCH_TASK_WORKER_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的 ResearchTaskWorker。',
  '你的职责是为一个明确 task 产出结构化 research notes、claims、evidence cards 和局限，不要写报告章节。',
  'Runtime 会负责状态流转、来源权限、证据落盘、引用解析和最终写作；你不能声称已经完成外部检索或访问网页。',
  '如果你只能基于通用知识和用户已确认 brief 生成资料卡，必须把 evidence 写成“待外部来源复核”的结构化资料，不要伪造具体 URL、出版物或脚注。',
  '输出必须是 JSON，不要 Markdown。'
].join('\n')

type ModelResearchCard = {
  sourceTitle?: unknown
  sourceType?: unknown
  reliability?: unknown
  reliabilityReason?: unknown
  evidenceText?: unknown
  claimText?: unknown
  claimType?: unknown
  confidence?: unknown
  critical?: unknown
  entities?: unknown
  noteSummary?: unknown
  implicationForBrief?: unknown
  limitations?: unknown
}

type ModelResearchPayload = {
  evidenceCards?: unknown
  unresolvedQuestions?: unknown
  conflicts?: unknown
  suggestedNextQueries?: unknown
}

export class ModelResearchTaskWorker implements ResearchTaskWorker {
  private readonly fallback: ResearchTaskWorker

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: ResearchTaskWorker
    }
  ) {
    this.fallback = options.fallback ?? new DefaultResearchTaskWorker()
  }

  async runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult> {
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_RESEARCH_TASK_WORKER_TIMEOUT_MS)
    )

    const turnId = `research_worker_${hashText(`${input.runId}:${input.task.id}:${input.brief.topic}`).slice(0, 12)}`
    const prompt = buildResearchWorkerPrompt(input)
    const maxTokens = 4_500
    const reservation = input.execution?.reserveModelCall(
      'worker',
      estimateResearchRequestTokens(`${MODEL_RESEARCH_TASK_WORKER_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_task_worker',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_RESEARCH_TASK_WORKER_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_task_worker',
            turnId,
            text: prompt
          })
        ],
        tools: [],
        stream: false,
        maxTokens,
        temperature: 0.2,
        responseFormat: 'json_object',
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'worker'),
        abortSignal: controller.signal
      }
      const collected = await collectModelText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const usageRecords = collected.usage.slice(-1).map((usage) => ({
        stage: 'worker' as const,
        model,
        turnId,
        taskId: input.task.id,
        usage
      }))
      if (input.execution && reservation && usageRecords[0]) {
        await input.execution.recordModelUsage(usageRecords[0], reservation)
        usageRecorded = true
      }
      return {
        ...parseModelResearchResult(collected.text, input),
        ...(!input.execution && usageRecords.length > 0 ? { modelUsage: usageRecords } : {})
      }
    } catch (error) {
      throwIfResearchAborted(input.execution?.signal)
      if (isFatalResearchTaskError(error)) throw error
      const fallback = await this.fallback.runTask(input)
      return {
        ...fallback,
        unresolvedQuestions: [
          ...fallback.unresolvedQuestions,
          `模型研究 worker 未返回可用结构化资料，已使用运行时兜底资料卡：${errorMessage(error)}。`
        ]
      }
    } finally {
      clearTimeout(timeout)
      unlinkAbort()
      if (input.execution && reservation) {
        const lastUsage = observedUsage.at(-1)
        if (!usageRecorded && lastUsage) {
          await input.execution.recordModelUsage({
            stage: 'worker',
            model,
            turnId,
            taskId: input.task.id,
            usage: lastUsage
          }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}

export function buildResearchWorkerPrompt(input: ResearchTaskWorkerInput): string {
  return [
    '请为这个 DeepResearch task 生成结构化研究资料。',
    '',
    '已确认 Brief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      targetAudience: input.brief.targetAudience,
      outputFormat: input.brief.outputFormat,
      sourcePolicy: input.brief.sourcePolicy,
      successCriteria: input.brief.successCriteria,
      constraints: input.brief.constraints
    }, null, 2),
    '',
    'ResearchFrame：',
    JSON.stringify({
      coreResearchThread: input.frame.coreResearchThread,
      centralQuestion: input.frame.centralQuestion,
      coreQuestions: input.frame.coreQuestions,
      evidenceNeeded: input.frame.evidenceNeeded,
      disconfirmingEvidenceNeeded: input.frame.disconfirmingEvidenceNeeded,
      nonGoals: input.frame.nonGoals
    }, null, 2),
    '',
    '当前 Task：',
    JSON.stringify({
      id: input.task.id,
      objective: input.task.objective,
      questionIds: input.task.questionIds,
      hypothesisIds: input.task.hypothesisIds ?? [],
      testIds: input.task.testIds ?? [],
      valueOfInformation: input.task.valueOfInformation,
      expectedEvidence: input.task.expectedEvidence,
      sourceTypesAllowedByRuntime: input.task.sourceTypes,
      searchHints: input.task.searchHints,
      maxSources: input.task.maxSources,
      priority: input.task.priority
    }, null, 2),
    '',
    '要求：',
    '- 只返回 JSON。',
    '- 生成 4 到 8 条 evidenceCards，但不要超过 task.maxSources。',
    '- 每条 card 都必须服务于核心研究主线和当前 task，不要泛泛百科介绍。',
    '- 优先寻找会改变、削弱或限定最终判断的证据；如果某条资料只是相关但不会改变结论，不要作为核心 card。',
    '- 如果 task.valueOfInformation 存在，必须围绕其中的 decisionRelevanceQuestion 和高分不确定性抽取资料。',
    '- 如果 Brief.userClarifications 非空，资料抽取和 implicationForBrief 必须优先回应这些用户补充要求。',
    '- claimText 要能直接支撑最终报告中的一个关键结论。',
    '- evidenceText 要写成可被引用的资料片段，中文为主；如果是基于通用知识，请明确“待外部来源复核”。',
    '- 不要写最终报告章节，不要写 Markdown 标题。',
    '- 不要伪造具体链接。没有真实访问来源时，sourceType 使用 local_file。',
    '',
    '返回 JSON schema：',
    '{',
    '  "evidenceCards": [',
    '    {',
    '      "sourceTitle": "资料卡标题",',
    '      "sourceType": "local_file",',
    '      "reliability": "low|medium|unknown",',
    '      "reliabilityReason": "为什么可信或需要复核",',
    '      "evidenceText": "可引用资料片段",',
    '      "claimText": "由该资料片段支持的原子论断",',
    '      "claimType": "fact|metric|date|quote|opinion|inference|recommendation",',
    '      "confidence": "high|medium|low",',
    '      "critical": true,',
    '      "entities": ["实体"],',
    '      "noteSummary": "结构化笔记摘要",',
    '      "implicationForBrief": "这条资料对 brief / 核心问题意味着什么",',
    '      "limitations": ["局限或待验证点"]',
    '    }',
    '  ],',
    '  "unresolvedQuestions": ["仍未解决的问题"],',
    '  "conflicts": [{"description": "潜在冲突", "claimIndexes": [0, 1]}],',
    '  "suggestedNextQueries": ["下一步检索 query"]',
    '}'
  ].join('\n')
}

export function parseModelResearchResult(raw: string, input: ResearchTaskWorkerInput): WorkerResult {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('Research worker response did not contain JSON')
  const payload = JSON.parse(json) as ModelResearchPayload
  const cards = normalizeCards(payload.evidenceCards).slice(0, Math.max(1, input.task.maxSources))
  if (cards.length === 0) throw new Error('Research worker response did not contain evidenceCards')

  const now = new Date().toISOString()
  const allowedSourceTypes = new Set(input.task.sourceTypes.length > 0
    ? input.task.sourceTypes
    : input.brief.sourcePolicy.allowedSourceTypes)
  const defaultSourceType = firstAllowedSourceType(allowedSourceTypes)
  const sources: SourceRecord[] = []
  const evidenceSpans: EvidenceSpan[] = []
  const claims: AtomicClaim[] = []
  const notes: ResearchNote[] = []

  cards.forEach((card, index) => {
    const sourceIndex = index + 1
    const sourceId = `${input.task.id}_model_source_${sourceIndex}`
    const spanId = `${input.task.id}_model_span_${sourceIndex}`
    const claimId = `${input.task.id}_model_claim_${sourceIndex}`
    const noteId = `${input.task.id}_model_note_${sourceIndex}`
    const sourceType = sourceTypeValue(card.sourceType, allowedSourceTypes) ?? defaultSourceType
    const reliability = reliabilityValue(card.reliability)
    const evidenceText = stringValue(card.evidenceText)
      || `围绕「${input.task.objective}」的模型资料卡：${stringValue(card.claimText) || input.frame.coreResearchThread}。待外部来源复核。`
    const claimText = stringValue(card.claimText)
      || `资料卡支持围绕「${input.frame.coreResearchThread}」展开当前问题。`
    const title = stringValue(card.sourceTitle)
      || `模型结构化资料卡 ${sourceIndex}：${input.task.objective}`
    const reliabilityReason = stringValue(card.reliabilityReason)
      || '由模型根据已确认 brief 生成，作为 P0 结构化资料卡；接入真实检索后需要外部来源复核。'
    const limitations = normalizeStringArray(card.limitations, 4)

    sources.push({
      id: sourceId,
      sourceType,
      title,
      path: `synthetic://deep-research/model-worker/${input.runId}/${input.task.id}/${sourceIndex}`,
      accessedAt: now,
      importedAt: now,
      language: 'zh-CN',
      reliability,
      reliabilityReason,
      sourcePolicyTags: ['model_generated', 'requires_external_verification', 'p0-runtime'],
      fingerprint: hashText(`${input.runId}:${input.task.id}:${sourceIndex}:${evidenceText}`),
      status: 'fetched',
      kind: 'model_fallback'
    })
    evidenceSpans.push({
      id: spanId,
      sourceId,
      text: evidenceText,
      textHash: hashText(evidenceText),
      location: {
        headingPath: ['模型结构化资料卡', input.task.id, title],
        paragraphIndex: 1
      },
      extractedAt: now,
      extractorRunId: input.runId
    })
    claims.push({
      id: claimId,
      text: claimText,
      entities: normalizeStringArray(card.entities, 8),
      claimType: claimTypeValue(card.claimType),
      supportSpanIds: [spanId],
      confidence: confidenceValue(card.confidence),
      critical: booleanValue(card.critical) ?? sourceIndex <= 3
    })
    notes.push({
      id: noteId,
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      claimIds: [claimId],
      summary: stringValue(card.noteSummary) || claimText,
      implicationForBrief: stringValue(card.implicationForBrief) || claimText,
      confidence: confidenceValue(card.confidence),
      limitations: limitations.length > 0
        ? limitations
        : ['该资料卡由模型生成，当前 P0 尚未接入真实网页或文件来源复核。']
    })
  })

  return {
    taskId: input.task.id,
    questionIds: input.task.questionIds,
    sources,
    evidenceSpans,
    claims,
    notes,
    unresolvedQuestions: normalizeStringArray(payload.unresolvedQuestions, 8),
    conflicts: normalizeConflicts(payload.conflicts, claims),
    suggestedNextQueries: normalizeStringArray(payload.suggestedNextQueries, 10)
  }
}

async function collectModelText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal,
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
): Promise<{ text: string; usage: ResearchModelUsageRecord['usage'][] }> {
  let text = ''
  const usage: ResearchModelUsageRecord['usage'][] = []
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('research worker timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'usage') {
      usage.push(chunk.usage)
      onUsage?.(chunk.usage)
    }
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('research worker returned empty text')
  return { text, usage }
}

function normalizeCards(value: unknown): ModelResearchCard[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord) as ModelResearchCard[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeConflicts(value: unknown, claims: AtomicClaim[]): ConflictCandidate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item, index) => {
      const claimIndexes = Array.isArray(item.claimIndexes) ? item.claimIndexes : []
      const claimIds = claimIndexes
        .map((candidate) => typeof candidate === 'number' ? candidate : Number(candidate))
        .filter((candidate) => Number.isInteger(candidate) && candidate >= 0 && candidate < claims.length)
        .map((candidate) => claims[candidate]?.id)
        .filter((candidate): candidate is string => Boolean(candidate))
      return {
        id: `conflict_${index + 1}`,
        claimIds,
        description: stringValue(item.description)
      }
    })
    .filter((item) => item.description)
    .slice(0, 6)
}

function sourceTypeValue(value: unknown, allowed: Set<ResearchSourceType>): ResearchSourceType | undefined {
  if (typeof value !== 'string') return undefined
  if (!isResearchSourceType(value)) return undefined
  return allowed.has(value) ? value : undefined
}

function firstAllowedSourceType(allowed: Set<ResearchSourceType>): ResearchSourceType {
  return allowed.values().next().value ?? 'local_file'
}

function isResearchSourceType(value: string): value is ResearchSourceType {
  return ['web', 'local_file', 'pdf', 'lark_doc', 'paper'].includes(value)
}

function reliabilityValue(value: unknown): SourceReliability {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'unknown'
    ? value
    : 'low'
}

function confidenceValue(value: unknown): ResearchConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function claimTypeValue(value: unknown): AtomicClaim['claimType'] {
  return value === 'fact'
    || value === 'metric'
    || value === 'date'
    || value === 'quote'
    || value === 'opinion'
    || value === 'inference'
    || value === 'recommendation'
    ? value
    : 'inference'
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', '1', '是'].includes(normalized)) return true
  if (['false', 'no', '0', '否'].includes(normalized)) return false
  return undefined
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
