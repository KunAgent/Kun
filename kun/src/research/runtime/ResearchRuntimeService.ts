/**
 * [INPUT]: 依赖 ResearchRuntime、ScopeAgent、ReportArchitect、Writer、ResearchEditor、ResearchRunRepository、范围列表解析、URL 清理和预算解析
 * [OUTPUT]: 对外提供 Web-only ResearchRuntimeService 和 HTTP DTO，用于在已批准 Workspace 按 UI 模型创建、列出、确认、批准、查询、取消、复用证据重试并恢复 research run，并完整保留用户以标签、句首或逗号后裸“比较/对比”列表、或“总体方面，包括子项”明确列出的研究维度生成章节；比较列表中的“相互关系”作为跨章综合要求，“分别分析”后的对象由场景解析器独立拆分
 * [POS]: research/runtime 的服务门面；固定 run 模型/Provider，只允许用户原题、用户补充和显式 overrides 形成 Brief/Frame 报告义务，逐项排除用途、受众和输出格式元数据，Scope 模型摘要不再创造主要矛盾、维度或来源边界；澄清不设固定轮次，只拦截完全重复回答
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomUUID } from 'node:crypto'
import type {
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchReasoningEffort,
  ResearchRun,
  ResearchScopeAssessment
} from '../core/types.js'
import { resolveResearchBudget } from '../core/presets.js'
import { extractComparisonTargets, isComparisonText } from '../core/comparison.js'
import { isScopeMetadataText } from '../core/scope-metadata.js'
import { splitTopLevelScopeList } from '../core/scope-list.js'
import { ResearchRuntime } from './ResearchRuntime.js'
import { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { DefaultResearchTaskWorker } from './DefaultResearchTaskWorker.js'
import { BasicScopeAgent, type ScopeAgent } from '../agents/ScopeAgent.js'
import type { ReportArchitect, ResearchEditor, ResearchTaskWorker, SynthesisWriter } from '../agents/types.js'
import { HeuristicQualityJudge, type QualityJudge } from '../verification/QualityJudge.js'
import { adaptResearchBudgetToSourceBoundary, deriveResearchSourcePolicy } from './ResearchSourcePolicy.js'
import {
  ResearchRunIndex,
  resolveResearchWorkspaceRoot,
  shouldAutoResumePersistedRun
} from './ResearchRunIndex.js'
import {
  buildClarifiedTopic,
  hashResearchTopicId,
  isScopeClarificationPrompt,
  normalizedScopeRequirements,
  researchRunTitle,
  responseForRun
} from './ResearchScopeInteraction.js'

export type CreateResearchRunRequest = {
  topic: string
  workspaceRoot?: string
  autoApprove?: boolean
  reasoningEffort?: ResearchReasoningEffort
  model?: string
  providerId?: string
  brief?: Partial<ResearchBrief>
  frame?: Partial<ResearchFrame>
  budget?: Partial<ResearchBudget>
}

export type ApproveResearchRunRequest = {
  briefHash?: string
  approvalMessageId?: string
  autoRun?: boolean
}

export type ConfirmResearchScopeRequest = {
  confirmationMessageId?: string
  autoApprove?: boolean
}

export type AnswerResearchScopeRequest = {
  message: string
  autoApprove?: boolean
}

export type ResearchRunApiResponse = {
  run: ResearchRun
  reportPath: string | null
  draftPath: string | null
  workspaceRoot: string
  artifactPaths: ResearchRun['artifacts']
  completed: boolean
}

export class ResearchRuntimeService {
  private readonly runtimesByRoot = new Map<string, ResearchRuntime>()
  private readonly runtimeByRunId = new Map<string, ResearchRuntime>()
  private readonly backgroundRunIds = new Set<string>()
  private readonly runIndex: ResearchRunIndex
  private readonly fallbackScopeAgent = new BasicScopeAgent()

  constructor(
    private readonly options: {
      dataDir: string
      allowedWorkspaceRoots?: string[]
      nowIso?: () => string
      idGenerator?: () => string
      scopeAgent?: ScopeAgent
      worker?: ResearchTaskWorker
      reportArchitect?: ReportArchitect
      synthesisWriter?: SynthesisWriter
      researchEditor?: ResearchEditor
      qualityJudge?: QualityJudge
    }
  ) {
    this.runIndex = new ResearchRunIndex(options.dataDir)
  }

  async initialize(): Promise<void> {
    const indexedRoots = await this.runIndex.load()
    const roots = new Set<string>([await this.resolveWorkspaceRoot(undefined)])
    for (const indexedRoot of Object.values(indexedRoots)) {
      const approvedRoot = await this.resolveWorkspaceRoot(indexedRoot).catch(() => null)
      if (approvedRoot) roots.add(approvedRoot)
    }
    for (const root of roots) {
      const runtime = this.runtimeForResolvedWorkspace(root)
      const runs = await runtime.restorePersistedRuns()
      for (const run of runs) {
        this.runtimeByRunId.set(run.id, runtime)
        this.runIndex.set(run.id, root)
        if (shouldAutoResumePersistedRun(run) && await runtime.prepareInterruptedRunForResume(run.id)) {
          this.startResearchInBackground(runtime, run.id)
        }
      }
    }
    await this.runIndex.write()
  }

  async createRun(input: CreateResearchRunRequest): Promise<ResearchRunApiResponse> {
    const topic = input.topic.trim()
    if (!topic) throw new Error('topic is required')
    const workspaceRoot = await this.resolveWorkspaceRoot(input.workspaceRoot)
    const runtime = this.runtimeForResolvedWorkspace(workspaceRoot)
    const nowIso = this.nowIso()
    const model = input.model?.trim()
    const providerId = input.providerId?.trim()
    const scope = await this.scopeAgent().assess({
      topic,
      nowIso,
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {})
    })
    const requestedBudget = resolveResearchBudget({
      ...input.budget,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      isComparisonTopic: isComparisonText(topic)
    })
    const preliminaryBrief = buildResearchBrief({
      topic,
      nowIso,
      scope,
      budget: requestedBudget,
      userClarifications: [],
      overrides: input.brief
    })
    const budget = adaptResearchBudgetToSourceBoundary(requestedBudget, preliminaryBrief, topic, input.budget)
    const brief = budget === requestedBudget
      ? preliminaryBrief
      : buildResearchBrief({ topic, nowIso, scope, budget, userClarifications: [], overrides: input.brief })
    const frame = buildResearchFrame({ topic, scope, userClarifications: [], overrides: input.frame })
    const run = await runtime.createRun({
      title: researchRunTitle(topic),
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {}),
      scope,
      brief,
      frame,
      budget
    })
    this.runtimeByRunId.set(run.id, runtime)
    await this.runIndex.setAndWrite(run.id, workspaceRoot)

    if (input.autoApprove === true) {
      if (!run.scope.readyForBrief) return responseForRun(run)
      const scopedRun = await runtime.confirmScope(run.id, {
        confirmedByUser: true,
        source: 'api',
        confirmationMessageId: 'auto-confirm-scope'
      })
      if (scopedRun.status !== 'awaiting_brief_confirm') {
        return responseForRun(scopedRun)
      }
      await runtime.approveBrief(run.id, {
        approvedByUser: true,
        briefHash: scopedRun.briefHash,
        source: 'api',
        approvalMessageId: 'auto-approve'
      })
      this.startResearchInBackground(runtime, run.id)
      return responseForRun(runtime.getRun(run.id) ?? run)
    }

    return responseForRun(run)
  }

  async confirmScope(runId: string, input: ConfirmResearchScopeRequest): Promise<ResearchRunApiResponse> {
    const runtime = this.mustRuntime(runId)
    const run = await runtime.confirmScope(runId, {
      confirmedByUser: true,
      confirmationMessageId: input.confirmationMessageId,
      source: 'api'
    })
    if (input.autoApprove === true && run.scope.readyForBrief && run.status === 'awaiting_brief_confirm') {
      await runtime.approveBrief(runId, {
        approvedByUser: true,
        briefHash: run.briefHash,
        source: 'api',
        approvalMessageId: 'auto-approve-after-scope-confirm'
      })
      this.startResearchInBackground(runtime, runId)
      return responseForRun(runtime.getRun(runId) ?? run)
    }
    return responseForRun(run)
  }

  async answerScope(runId: string, input: AnswerResearchScopeRequest): Promise<ResearchRunApiResponse> {
    const message = input.message.trim()
    if (!message) throw new Error('scope clarification message is required')
    const runtime = this.mustRuntime(runId)
    const existing = runtime.getRun(runId)
    if (!existing) throw new Error(`Unknown research run ${runId}`)
    const normalizedMessage = normalizeScopeClarificationMessage(message)
    if (existing.scopeClarifications.some((item) => normalizeScopeClarificationMessage(item.message) === normalizedMessage)) {
      throw new Error('scope clarification repeated the same answer; please provide new information or confirm the current scope')
    }
    const attemptModelCalls = existing.modelBudgetUsage.modelCalls - (existing.attemptBudgetBaseline?.modelCalls ?? 0)
    if (attemptModelCalls >= existing.budget.maxModelCalls) {
      throw new Error('research_model_call_budget_exhausted: scope clarification cannot consume the model calls reserved for research and report synthesis')
    }
    const nowIso = this.nowIso()
    const clarifications = [
      ...existing.scopeClarifications.map((item) => ({ message: item.message })),
      { message }
    ]
    const scope = await this.scopeAgent().assess({
      topic: existing.brief.topic,
      clarifications,
      pendingQuestions: existing.scope.clarificationQuestions,
      nowIso,
      ...(existing.model ? { model: existing.model } : {}),
      ...(existing.providerId ? { providerId: existing.providerId } : {})
    })
    const confirmedRequirements = clarifications.flatMap((item) => normalizedScopeRequirements(item.message))
    const scopedTopic = buildClarifiedTopic(existing.brief.topic, message, scope, cleanTopicForFrame)
    const previousClarifications = existing.scopeClarifications.flatMap((item) => normalizedScopeRequirements(item.message))
    const briefOverrides = customBriefOverrides(existing, previousClarifications, scopedTopic, confirmedRequirements, nowIso)
    const frameOverrides = customFrameOverrides(existing, previousClarifications)
    const run = await runtime.answerScope(runId, {
      message,
      scope,
      brief: buildResearchBrief({
        topic: scopedTopic,
        nowIso,
        scope,
        budget: existing.budget,
        userClarifications: confirmedRequirements,
        overrides: briefOverrides
      }),
      frame: buildResearchFrame({
        topic: scopedTopic,
        scope,
        userClarifications: confirmedRequirements,
        overrides: frameOverrides
      })
    })

    if (input.autoApprove === true && run.scope.readyForBrief) {
      const confirmed = await runtime.confirmScope(runId, {
        confirmedByUser: true,
        source: 'api',
        confirmationMessageId: 'auto-confirm-after-scope-answer'
      })
      if (confirmed.status !== 'awaiting_brief_confirm') {
        return responseForRun(confirmed)
      }
      await runtime.approveBrief(runId, {
        approvedByUser: true,
        briefHash: confirmed.briefHash,
        source: 'api',
        approvalMessageId: 'auto-approve-after-scope-answer'
      })
      this.startResearchInBackground(runtime, runId)
      return responseForRun(runtime.getRun(runId) ?? run)
    }

    return responseForRun(run)
  }

  async approveRun(runId: string, input: ApproveResearchRunRequest): Promise<ResearchRunApiResponse> {
    const runtime = this.mustRuntime(runId)
    const run = runtime.getRun(runId)
    if (!run) throw new Error(`Unknown research run ${runId}`)
    const approved = await runtime.approveBrief(runId, {
      approvedByUser: true,
      briefHash: input.briefHash ?? run.briefHash,
      approvalMessageId: input.approvalMessageId,
      source: 'api'
    })
    if (input.autoRun === false) {
      return responseForRun(approved)
    }
    this.startResearchInBackground(runtime, runId)
    return responseForRun(runtime.getRun(runId) ?? approved)
  }

  getRun(runId: string): ResearchRunApiResponse {
    const runtime = this.mustRuntime(runId)
    const run = runtime.getRun(runId)
    if (!run) throw new Error(`Unknown research run ${runId}`)
    return responseForRun(run)
  }

  listRuns(limit = 20): ResearchRunApiResponse[] {
    const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)))
    return [...this.runtimeByRunId.entries()]
      .map(([runId, runtime]) => runtime.getRun(runId))
      .filter((run): run is ResearchRun => Boolean(run))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, boundedLimit)
      .map(responseForRun)
  }

  async cancelRun(runId: string, reason?: string): Promise<ResearchRunApiResponse> {
    const runtime = this.mustRuntime(runId)
    const run = await runtime.cancelRun(runId, reason)
    return responseForRun(run)
  }

  async retryRun(runId: string): Promise<ResearchRunApiResponse> {
    const runtime = this.mustRuntime(runId)
    const run = await runtime.retryFailedRun(runId)
    this.startResearchInBackground(runtime, runId)
    return responseForRun(run)
  }

  private runtimeForResolvedWorkspace(root: string): ResearchRuntime {
    const existing = this.runtimesByRoot.get(root)
    if (existing) return existing
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot: root }),
      worker: this.options.worker ?? new DefaultResearchTaskWorker(),
      reportArchitect: this.options.reportArchitect,
      synthesisWriter: this.options.synthesisWriter,
      researchEditor: this.options.researchEditor,
      qualityJudge: this.options.qualityJudge ?? new HeuristicQualityJudge(),
      idGenerator: this.options.idGenerator ?? (() => `rr_${randomUUID()}`),
      nowIso: this.options.nowIso
    })
    this.runtimesByRoot.set(root, runtime)
    return runtime
  }

  private resolveWorkspaceRoot(workspaceRoot: string | undefined): Promise<string> {
    return resolveResearchWorkspaceRoot(
      this.options.dataDir,
      workspaceRoot,
      this.options.allowedWorkspaceRoots
    )
  }

  private mustRuntime(runId: string): ResearchRuntime {
    const runtime = this.runtimeByRunId.get(runId)
    if (!runtime) throw new Error(`Unknown research run ${runId}`)
    return runtime
  }

  private nowIso(): string {
    return (this.options.nowIso ?? (() => new Date().toISOString()))()
  }

  private scopeAgent(): ScopeAgent {
    return this.options.scopeAgent ?? this.fallbackScopeAgent
  }

  private startResearchInBackground(runtime: ResearchRuntime, runId: string): void {
    if (this.backgroundRunIds.has(runId)) return
    this.backgroundRunIds.add(runId)
    setTimeout(() => {
      void runtime.runConfirmedResearch(runId)
        .catch(() => undefined)
        .finally(() => {
          this.backgroundRunIds.delete(runId)
        })
    }, 0)
  }
}

function normalizeScopeClarificationMessage(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s，。！？、,.;:：；!?]+/gu, '').trim()
}

function customBriefOverrides(
  existing: ResearchRun,
  previousClarifications: string[],
  scopedTopic: string,
  confirmedRequirements: string[],
  nowIso: string
): Partial<ResearchBrief> {
  const generated = buildResearchBrief({
    topic: existing.brief.topic,
    nowIso: existing.brief.createdAt,
    scope: existing.scope,
    budget: existing.budget,
    userClarifications: previousClarifications
  })
  return {
    id: existing.brief.id,
    version: existing.brief.version,
    topic: scopedTopic,
    userClarifications: confirmedRequirements,
    createdAt: existing.brief.createdAt,
    updatedAt: nowIso,
    ...(existing.brief.userIntent !== generated.userIntent ? { userIntent: existing.brief.userIntent } : {}),
    ...(existing.brief.targetAudience !== generated.targetAudience ? { targetAudience: existing.brief.targetAudience } : {}),
    ...(existing.brief.outputFormat !== generated.outputFormat ? { outputFormat: existing.brief.outputFormat } : {}),
    ...(!sameJson(existing.brief.sourcePolicy, generated.sourcePolicy) ? { sourcePolicy: existing.brief.sourcePolicy } : {}),
    ...(!sameJson(existing.brief.successCriteria, generated.successCriteria) ? { successCriteria: existing.brief.successCriteria } : {}),
    ...(!sameJson(existing.brief.constraints, generated.constraints) ? { constraints: existing.brief.constraints } : {})
  }
}

function customFrameOverrides(existing: ResearchRun, previousClarifications: string[]): Partial<ResearchFrame> | undefined {
  const generated = buildResearchFrame({
    topic: existing.brief.topic,
    scope: existing.scope,
    userClarifications: previousClarifications
  })
  return sameJson(existing.frame, generated) ? undefined : existing.frame
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildResearchBrief(input: {
  topic: string
  nowIso: string
  scope?: ResearchScopeAssessment
  budget?: ResearchBudget
  userClarifications?: string[]
  overrides?: Partial<ResearchBrief>
}): ResearchBrief {
  const userClarifications = input.overrides?.userClarifications ?? input.userClarifications ?? []
  const constraints = input.overrides?.constraints ?? [
    '优先使用 runtime 可抓取的网页来源；来源不足或抽取失败时，必须明确说明证据缺口。'
  ]
  const sourcePolicy = deriveResearchSourcePolicy(input.overrides?.sourcePolicy ?? {
    allowedSourceTypes: ['web'],
    minSourceCount: input.budget?.minSources ?? 5,
    maxSourceCount: input.budget?.maxSources ?? 16,
    requireCitations: true
  }, [
    input.topic,
    ...userClarifications,
    ...constraints
  ].filter(Boolean).join('\n'))
  return {
    id: input.overrides?.id ?? `brief_${hashResearchTopicId(input.topic)}`,
    version: input.overrides?.version ?? 1,
    topic: input.overrides?.topic ?? input.topic,
    userIntent: input.overrides?.userIntent ?? buildUserIntent(input.topic, userClarifications),
    ...(userClarifications.length > 0 ? { userClarifications } : {}),
    targetAudience: input.overrides?.targetAudience,
    outputFormat: input.overrides?.outputFormat ?? 'Markdown 中文完整报告，篇幅服从问题复杂度和证据密度，并保留可追溯引用',
    sourcePolicy,
    successCriteria: input.overrides?.successCriteria ?? buildSuccessCriteria(userClarifications),
    constraints,
    createdAt: input.overrides?.createdAt ?? input.nowIso,
    updatedAt: input.overrides?.updatedAt
  }
}

export class ScopeFrameMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeFrameMappingError'
  }
}

export function buildResearchFrame(input: {
  topic: string
  scope?: ResearchScopeAssessment
  userClarifications?: string[]
  overrides?: Partial<ResearchFrame>
}): ResearchFrame {
  assertFrameOverridesDoNotLeakScopePrompts(input.overrides)
  const frameTopic = cleanTopicForFrame(input.topic)
  const userOwnedScopeText = [
    input.topic,
    ...(input.userClarifications ?? []).flatMap((message) => message
      .split(/\n+/u)
      .map(scopeRequirementAnswerText)
      .filter(Boolean))
  ].filter(Boolean).join('\n')
  const userRequiredDimensions = requiredDimensionsFromScopeText(userOwnedScopeText)
  const requiredDimensions = userRequiredDimensions
  const extractedAlternatives = extractComparisonTargets(userOwnedScopeText)
  const alternativesToCompare = (input.overrides?.alternativesToCompare?.length ?? 0) >= 2
    ? input.overrides?.alternativesToCompare ?? []
    : extractedAlternatives
  const coreQuestion = input.overrides?.centralQuestion ??
    centralQuestionFromScopeText(frameTopic, userOwnedScopeText, requiredDimensions, alternativesToCompare)
  const coreResearchThread = input.overrides?.coreResearchThread
    ?? `准确回答用户已确认的研究请求：${frameTopic}`
  const coreQuestions = dedupeCoreQuestions(input.overrides?.coreQuestions ?? buildDefaultCoreQuestions({
    topic: frameTopic,
    coreQuestion,
    coreResearchThread,
    requiredDimensions
  }))
  const frame = {
    coreResearchThread,
    centralQuestion: coreQuestion,
    decisionToSupport: input.overrides?.decisionToSupport,
    targetUserOrActor: input.overrides?.targetUserOrActor,
    coreTask: input.overrides?.coreTask,
    currentPath: input.overrides?.currentPath,
    keyFriction: input.overrides?.keyFriction,
    interventionHypothesis: input.overrides?.interventionHypothesis,
    alternativesToCompare: alternativesToCompare.length >= 2 ? alternativesToCompare : undefined,
    coreQuestions,
    investigationPath: input.overrides?.investigationPath ?? [
      '确认调研简报',
      '围绕核心矛盾拆解多个研究问题',
      '并行收集事实、数据、案例、反证和边界条件',
      '按问题沉淀结构化证据笔记',
      '先形成报告大纲，再合成带引用的完整报告',
      '运行确定性校验和 LLM Judge，未达标则重写'
    ],
    evidenceNeeded: input.overrides?.evidenceNeeded ?? [
      '定义、范围和可比口径证据，用于避免调研对象不清。',
      '关键事实、指标、时间线、案例或原始数据，用于支撑主要判断。',
      '核心路径或机制证据，用于解释为什么这些事实会导向当前矛盾。',
      '对比对象、替代解释或反例证据，用于避免单边结论。',
      '面向用户决策或理解的结论证据，用于形成可执行建议。'
    ],
    disconfirmingEvidenceNeeded: input.overrides?.disconfirmingEvidenceNeeded ?? [
      '寻找至少一个可能推翻主结论或限制主结论适用范围的证据。',
      '如果关键指标、口径或来源之间存在冲突，需要明确冲突和可信度判断。'
    ],
    nonGoals: input.overrides?.nonGoals ?? [
      '不为了凑字数堆砌百科资料；所有展开都必须服务于核心研究主线。',
      '不把模型生成资料卡伪装成真实网页或官方来源。'
    ]
  }
  const repairedFrame = repairGeneratedScopePromptLeaks(frame, {
    topic: frameTopic,
    requiredDimensions
  })
  assertNoScopePromptLeak(repairedFrame)
  return repairedFrame
}

function dedupeCoreQuestions(questions: ResearchFrame['coreQuestions']): ResearchFrame['coreQuestions'] {
  const dimensions = questions.map((question) => dimensionFromQuestion(question.text))
  const seen = new Set<string>()
  return questions.filter((question, index) => {
    const normalizedQuestion = question.text.replace(/\s+/g, '')
    if (seen.has(normalizedQuestion)) return false
    seen.add(normalizedQuestion)
    const dimension = dimensions[index]
    if (!dimension) return true
    return !dimensions.some((candidate, candidateIndex) =>
      candidateIndex !== index && candidate && isBroadDimensionDuplicate(dimension, candidate)
    )
  })
}

function dimensionFromQuestion(value: string): string | undefined {
  return cleanFrameText(value.match(/^在「(.+?)」维度/u)?.[1])
}

function isBroadDimensionDuplicate(dimension: string, candidate: string): boolean {
  const broad = dimension.replace(/[\s、，,]/g, '')
  const specific = candidate.replace(/[\s、，,]/g, '')
  if (!broad || broad === specific || !specific.startsWith(broad)) return false
  const detail = specific.slice(broad.length)
  return /^(?:(?:与|和|及|及其))?(?:增长|增速|趋势|格局|强度|能力|潜力|表现|现状|风险|机会|机制|模式|偏好|结构)$/u.test(detail)
}

function buildDefaultCoreQuestions(input: {
  topic: string
  coreQuestion?: string
  coreResearchThread: string
  requiredDimensions?: string[]
}): ResearchFrame['coreQuestions'] {
  const dimensions = input.requiredDimensions ?? []
  const questions = dimensions.length > 0
    ? [
        input.coreQuestion ?? `围绕「${input.topic}」最需要回答的核心结论是什么？`,
        ...dimensions.map((dimension) => `在「${dimension}」维度上，关键事实、作用机制、风险和适用边界是什么？`),
        `有哪些反例、替代解释、口径限制或边界条件会改变对「${input.topic}」的判断？`
      ]
    : [
        input.coreQuestion ?? `围绕「${input.topic}」最需要回答的核心结论是什么？`,
        `「${input.topic}」的调研范围、关键概念和可比口径应该如何界定？`,
        `当前有哪些关键事实、指标、案例或时间线能够支撑对「${input.topic}」的判断？`,
        `形成「${input.coreResearchThread}」这条主线的主要机制、用户路径或因果链是什么？`,
        `有哪些反例、替代解释、利益相关方分歧或边界条件会改变结论？`,
        `基于以上证据，用户应该如何理解「${input.topic}」的结论、风险和下一步行动？`
      ]
  const uniqueQuestions = [...new Set(questions.map((question) => question.trim()).filter(Boolean))]
  return uniqueQuestions.map((text, index) => ({
    id: `q${index + 1}`,
    text,
    priority: questionPriority({ text, index, dimensions }),
    required: questionRequired({ text, index, dimensions })
  }))
}

function buildUserIntent(topic: string, userClarifications: string[]): string {
  const confirmedRequest = cleanTopicForFrame([topic, ...userClarifications].filter(Boolean).join('；'))
  return `准确回答用户已确认的研究请求「${confirmedRequest}」，生成有主线、有证据绑定、篇幅服从问题复杂度和证据密度的完整调研报告。`
}

function buildSuccessCriteria(userClarifications: string[] = []): string[] {
  const criteria = [
    '产出一份结构清晰、信息密度优先、带可追溯引用绑定的完整报告草稿。',
    '逐项回答用户原始问题中明确要求的概念、关系、比较和场景，不增加原题之外的研究义务。',
    '每个必答章节都使用与该章节直接相关的可引用证据，并明确证据没有覆盖的边界。'
  ]
  if (userClarifications.length > 0) {
    criteria.splice(1, 0, '报告必须显式覆盖用户在 scope 阶段补充的选项、文本要求和边界条件。')
  }
  return criteria
}

function centralQuestionFromScopeText(
  topic: string,
  text: string,
  dimensions: string[],
  comparisonTargets: string[] = []
): string {
  const explicitCore = labeledScopeValue(text, ['核心问题', '核心是'])
  const cleanedCore = cleanFrameText(explicitCore)
  if (cleanedCore) {
    if (/综合实力|差距|优势|风险|机会|竞争力|判断|决策|对比|比较/.test(cleanedCore)) {
      return cleanedCore.endsWith('？') || cleanedCore.endsWith('?') ? cleanedCore : `${cleanedCore}？`
    }
    return `围绕「${topic}」，${cleanedCore}`
  }

  if (comparisonTargets.length >= 2) {
    const targetText = comparisonTargets.map((target) => `“${target}”`).join('与')
    const topicNamesEveryTarget = comparisonTargets.every((target) =>
      normalizeComparisonSubjectText(topic).includes(normalizeComparisonSubjectText(target))
    )
    if (!topicNamesEveryTarget) {
      return dimensions.length > 0
        ? `围绕「${topic}」，用户明确要求的各项研究维度应如何分别回答，并通过与${targetText}的必要比较检验核心判断？`
        : `围绕「${topic}」，应如何通过与${targetText}的必要比较回答核心判断？`
    }
    return dimensions.length > 0
      ? `${targetText}在${dimensions.join('、')}上的差异应如何由证据回答？`
      : `${targetText}的用户明确比较要求应如何由证据回答？`
  }
  if (dimensions.length > 0) {
    return `围绕「${topic}」，用户明确要求的各项研究维度应如何分别回答，并在证据允许的范围内说明相互关系？`
  }
  return `用户读完后应该真正理解「${topic}」的什么？`
}

function normalizeComparisonSubjectText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function requiredDimensionsFromScopeText(text: string): string[] {
  const dimensions: string[] = []
  const deferredSeparateScenarios: string[] = []
  const scopeLines = text.split(/\n|(?<=[。！？!?；;])/u).map((item) => item.trim()).filter(Boolean)
  const dimensionText = text
    .split(/\n|(?<=[。！？!?])/u)
    .map((item) => stripScopeUrls(item).trim())
    .filter(Boolean)
    .filter((line) => !isScopeMetadataLine(line))
    .join('\n')
  const push = (value: string) => {
    const cleaned = cleanFrameText(value)
    if (!cleaned || isScopeMetadataLine(cleaned)) return
    if (isMeaningfulDimension(cleaned) && !dimensions.includes(cleaned)) dimensions.push(cleaned)
  }
  const labeledDimensions = labeledDimensionValue(dimensionText)
  for (const part of splitTopLevelScopeList(labeledDimensions).map((item) => cleanFrameText(item)).filter(Boolean)) {
    if (part && part.length <= 48) push(part)
  }
  for (const line of scopeLines) {
    if (isScopePromptLeak(line)) continue
    if (isCompetitorCoverageInstruction(line)) continue
    const scenarioList = line.match(/(?:包含|涵盖|覆盖)\s*([^；。\n]{2,100}?)场景/u)?.[1]
    for (const scenario of scenarioDimensionParts(scenarioList ?? '')) push(scenario)
    const separateScenarioList = line.match(/(?:分别|各自)(?:分析|说明|讨论|研究|解释)\s*([^；。\n]{2,100})/u)?.[1]
    deferredSeparateScenarios.push(...scenarioDimensionParts(separateScenarioList ?? ''))
    if (isDeliveryDirectiveClause(line)) continue
    if (isScopeMetadataLine(line)) continue
    const explicitImpactObjects = line.match(/(?:对|影响到)\s*([^。；\n]{3,120}?)\s*(?:的)?实际(?:影响|作用|表现|效果|结果)/u)?.[1]
    for (const dimension of explicitDimensionParts(explicitImpactObjects ?? '')) push(dimension)
    const candidates = [
      explicitComparisonAspectList(line),
      explicitSubjectAspectList(line),
      line.match(/(?:领域|方面|维度)[^：:\n]{0,100}[？?]?[：:]\s*(.+)$/u)?.[1],
      line.match(/(?:重点回答|重点关注|重点比较|主要包括|主要关注|回答|重点澄清|澄清)\s*[:：]?\s*(.+)$/u)?.[1],
      line.match(/(?:涵盖|覆盖)\s*([^。；\n]+)/u)?.[1],
      line.match(/从\s*([^。；\n]{2,100}?)(?:进行)?分析(?:[^，。；\n]*)?/u)?.[1],
      line.match(/(?:对比|比较)[^，。\n]{1,80}?的([^，。\n]{2,30}?)(?:差异|区别)/u)?.[1],
      line.match(/(?:解释|分析|比较|对比)\s*([^；。\n]{2,160}?)(?:之间)?(?:的区别|的差异|的异同|的协同机制)/u)?.[1],
      line.match(/根据([^，。\n]{2,50}?)(?:差异)?(?:选择|判断|决策)/u)?.[1]
    ].filter((value): value is string => Boolean(value?.trim()))
    for (const candidate of candidates) {
      for (const part of explicitDimensionParts(candidate)) push(part)
    }
    const pairedAnalysis = line.match(/(?:同时)?按\s*([^，,。；;\n]{2,30}?)\s*(?:与|和|及)\s*([^，,。；;\n]{2,30}?)(?:进行)?分析/u)
    if (pairedAnalysis) {
      push(cleanExplicitDimension(pairedAnalysis[1]))
      push(cleanExplicitDimension(pairedAnalysis[2]))
    }
  }
  if (dimensions.length === 0) {
    for (const dimension of explicitRelationshipDimensions(dimensionText)) push(dimension)
  }
  for (const scenario of deferredSeparateScenarios) push(scenario)
  return dimensions
}

function stripScopeUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"'，。！？；;、]+/giu, ' ')
}

function explicitRelationshipDimensions(text: string): string[] {
  const dimensions: string[] = []
  const push = (value: string | undefined) => {
    const cleaned = cleanExplicitDimension(value)
    if (isMeaningfulDimension(cleaned) && !dimensions.includes(cleaned)) dimensions.push(cleaned)
  }
  for (const rawClause of text.split(/[、，,。！？!?；;\n]/u).map((value) => value.trim()).filter(Boolean)) {
    const clause = stripTrailingDeliveryRequirement(rawClause)
    if (!clause) continue
    if (/(?:分别|各自)(?:分析|说明|讨论|研究|解释)/u.test(clause)) continue
    if (
      /的实际(?:影响|作用|表现|效果|结果|意义)$/u.test(clause) &&
      !/(?:比较|对比|区别|差异|异同|关系|关联|协同)/u.test(clause)
    ) continue
    const scenarioPair = clause.match(/(?:在|针对)\s*([^，,。；;\n]{2,32}?)\s*(?:与|和|\bvs\.?\b|\bversus\b)\s*([^，,。；;\n]{2,32}?)(?:中|下|上)(?:的)?(?:实践|应用|策略|表现)?(?:差异|区别|异同)/iu)
    if (scenarioPair) {
      push(scenarioPair[1])
      push(scenarioPair[2])
      continue
    }
    if (!/(?:与|和|\bvs\.?\b|\bversus\b)/iu.test(clause)) continue
    if (extractComparisonTargets(clause).length >= 2) continue
    const pair = clause.match(/^(.{1,60}?)\s*(?:与|和|\bvs\.?\b|\bversus\b)\s*(.{1,60})$/iu)
    if (!pair) continue
    const left = cleanExplicitDimension(pair[1], true)
    const right = cleanExplicitDimension(pair[2])
    if (!isMeaningfulDimension(left) || !isMeaningfulDimension(right)) continue
    const combined = `${left} 与 ${right}`
    if (combined.length <= 30 && !dimensions.includes(combined)) dimensions.push(combined)
  }
  return dimensions
}

function cleanExplicitDimension(value: string | undefined, removeResearchPrefix = false): string {
  let cleaned = cleanFrameText(value) ?? ''
  if (removeResearchPrefix) {
    cleaned = cleaned
      .replace(/^.*?(?:解释|分析|比较|对比|区分|包括|涵盖|覆盖)\s*/u, '')
      .replace(/^.*(?:中|下)\s*(?=[\p{L}\p{N}])/u, '')
  }
  return cleaned
    .replace(/^(?:以及|并且|同时|它们|两者)\s*(?:在)?\s*/u, '')
    .replace(/^(?:在|针对)\s*/u, '')
    .replace(/(?:的)?(?:具体)?(?:含义|关系|差异|区别|异同|协同机制|实践差异|应用差异|策略差异)$/u, '')
    .replace(/(?:中|下|上)的?(?:实践|应用|策略|表现)?(?:差异|区别|异同)$/u, '')
    .trim()
}

function isCompetitorCoverageInstruction(value: string): boolean {
  return /(?:(?:比较|对比|竞争|对标)(?:范围|对象)|竞争对手)/u.test(value)
    || /(?:全部覆盖|重点覆盖).{0,80}(?:对象|参与者|主体)/u.test(value)
}

function isScopeMetadataLine(value: string): boolean {
  return isScopeMetadataText(value)
}

function explicitDimensionParts(value: string): string[] {
  const researchValue = stripTrailingDeliveryRequirement(value)
  if (!researchValue || /(?:怎么选|如何选择|如何决策)/u.test(researchValue)) return []
  const hasPunctuationSeparator = /[、,，;；/]/u.test(researchValue)
  const parts = splitTopLevelScopeList(researchValue, {
    wordSeparators: hasPunctuationSeparator ? ['以及', '并且', '及', '和'] : ['以及', '并且', '及']
  })
  return parts
    .map((item, index) => {
      let cleaned = item
        .replace(/^(?:领域|方面|维度|范围)\s*[:：]\s*/u, '')
        .replace(/^在[^，,]{1,24}中\s*/u, '')
      if (index === 0 && parts.length >= 2) cleaned = cleaned.replace(/^.{1,24}中(?=[\p{L}\p{N}])/u, '')
      return cleaned
        .replace(/(?:有什么|有何|存在哪些)?(?:的)?(?:区别|差异|异同|关系|边界).*$/u, '')
        .replace(/[一二三四五六七八九十百\d]+个维度$/u, '')
        .trim()
    })
    .map((item) => cleanExplicitDimension(cleanFrameText(item)))
    .filter((item): item is string => Boolean(
      item &&
      item.length <= 48 &&
      !isScopeMetadataLine(item) &&
      !/^(?:无|不限|全面对比|默认|两者|双方)$/u.test(item)
    ))
}

function explicitSubjectAspectList(value: string): string | undefined {
  const aspectList = value.match(
    /(?:^|[\s，,。；;：:])\s*(?:请\s*)?(?:(?:全面|综合|系统|深入|重点)\s*)?(?:分析|研究|评估|调研)\s*[^，,。；;\n]{1,80}?的\s*([^。；;\n]{2,180})/u
  )?.[1]?.trim()
  if (!aspectList || !/[、，,；;]/u.test(aspectList)) return undefined
  const includedItems = aspectList.match(/^[^，,]{2,48}[，,]\s*(?:包括|涵盖|覆盖)\s*(.+)$/u)?.[1]?.trim()
  const explicitItems = includedItems && explicitDimensionParts(includedItems).length >= 2
    ? includedItems
    : aspectList
  return explicitDimensionParts(explicitItems).length >= 2 ? explicitItems : undefined
}

function explicitComparisonAspectList(value: string): string | undefined {
  const rawAspectList = value.match(
    /(?:^|[，,。！？!?；;]\s*)\s*(?:请\s*)?(?:(?:全面|综合|系统|深入|重点)\s*)?(?:比较|对比)\s*([^。；;\n]{2,220})/u
  )?.[1]?.trim()
  const aspectList = rawAspectList
    ?.replace(/[，,]\s*(?:(?:并|同时|以及)\s*)?(?:分别|各自)(?:分析|说明|讨论|研究|解释)[\s\S]*$/u, '')
    .replace(/[、，,]?\s*(?:以及|并且|和|及)?\s*(?:它们|两者|二者)?(?:的)?相互(?:关系|关联|联系)\s*$/u, '')
    .trim()
  if (!aspectList || !/[、，,；;]/u.test(aspectList)) return undefined
  return explicitDimensionParts(aspectList).length >= 2 ? aspectList : undefined
}

function stripTrailingDeliveryRequirement(value: string): string {
  return value.replace(
    /(?:[，,、]\s*)?(?:(?:并|同时|以及)\s*)?(?:明确|说明|标注|注明|列出|给出)[^，,。；;\n]{0,60}(?:证据边界|证据限制|来源限制|局限(?:性)?|不确定性|数据截止(?:日|时间))[^，,。；;\n]*[。.]?$/u,
    ''
  ).trim()
}

function scopeRequirementAnswerText(value: string): string {
  const separatorIndex = value.search(/[:：]/u)
  if (separatorIndex < 0) return value
  const label = value.slice(0, separatorIndex)
  const answer = value.slice(separatorIndex + 1).trim()
  return /[？?]/u.test(label) && answer ? answer : value
}

function scenarioDimensionParts(value: string): string[] {
  return value
    .split(/[、,，;；/]|\s*(?:以及|并且|及|和|与)\s*/u)
    .map((item) => cleanFrameText(item))
    .filter((item): item is string => Boolean(item && item.length <= 24))
    .map((item) => item.endsWith('场景') ? item : `${item}场景`)
}

function labeledDimensionValue(text: string): string {
  const lines = text.split(/\n/)
  for (const line of lines) {
    if (isScopePromptLeak(line)) continue
    const match = line.match(/(?:^|[；;，,。\s]|比较|调研|研究)(?:领域|维度|调研范围|范围)\s*[:：是为]\s*(.+)$/u)
    const value = match?.[1]?.trim()
    if (value && !/^明确(?:[，,；;。]|$)/u.test(value)) return value
  }
  return ''
}

function labeledScopeValue(text: string, labels: string[]): string {
  const lines = text.split(/\n/)
  for (const line of lines) {
    if (isScopePromptLeak(line)) continue
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = line.match(new RegExp(`${escaped}\\s*[:：是]?\\s*(.+)$`, 'u'))
      if (match?.[1]) return match[1].trim()
    }
  }
  return ''
}

function cleanFrameText(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/^[-*\d.、\s]+/, '')
    .replace(/^补充[:：]\s*/, '')
    .replace(/^选择[:：]\s*/, '')
    .replace(/^回答[:：]\s*/, '')
    .replace(/^答复[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;，,、]+$/u, '')
    .trim()
  if (!cleaned || isScopePromptLeak(cleaned)) return undefined
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned
}

function assertFrameOverridesDoNotLeakScopePrompts(overrides: Partial<ResearchFrame> | undefined): void {
  if (!overrides) return
  const fields = [
    ['centralQuestion', overrides.centralQuestion],
    ['coreResearchThread', overrides.coreResearchThread],
    ...(overrides.coreQuestions ?? []).map((question) => [`coreQuestions.${question.id}`, question.text] as const)
  ] as Array<readonly [string, string | undefined]>
  for (const [field, value] of fields) {
    if (value && isScopePromptLeak(value)) {
      throw new ScopeFrameMappingError(`ResearchFrame.${field} contains a scope clarification prompt instead of a research question: ${value}`)
    }
  }
}

function repairGeneratedScopePromptLeaks(
  frame: ResearchFrame,
  input: {
    topic: string
    requiredDimensions: string[]
  }
): ResearchFrame {
  const frameFields = [
    frame.centralQuestion,
    frame.coreResearchThread,
    ...frame.coreQuestions.map((question) => question.text)
  ]
  if (frameFields.every((value) => !isScopePromptLeak(value))) return frame

  const cleanCentralQuestion = isScopePromptLeak(frame.centralQuestion)
    ? centralQuestionFromScopeText(input.topic, [
        input.topic,
        ...input.requiredDimensions
      ].join('\n'), input.requiredDimensions)
    : frame.centralQuestion
  const cleanCoreResearchThread = isScopePromptLeak(frame.coreResearchThread)
    ? `围绕「${input.topic}」，抓住最能改变最终判断的证据，回答：${cleanCentralQuestion}`
    : frame.coreResearchThread
  const defaultQuestions = buildDefaultCoreQuestions({
    topic: input.topic,
    coreQuestion: cleanCentralQuestion,
    coreResearchThread: cleanCoreResearchThread,
    requiredDimensions: input.requiredDimensions
  })
  const cleanExistingQuestions = frame.coreQuestions.filter((question) => !isScopePromptLeak(question.text))
  const mergedQuestions = [...defaultQuestions, ...cleanExistingQuestions]
  const seen = new Set<string>()
  const coreQuestions = mergedQuestions
    .filter((question) => {
      const key = question.text.trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((question, index) => ({ ...question, id: `q${index + 1}` }))

  return {
    ...frame,
    centralQuestion: cleanCentralQuestion,
    coreResearchThread: cleanCoreResearchThread,
    coreQuestions
  }
}

function cleanTopicForFrame(value: string): string {
  const normalized = stripInlineDeliveryMetadata(value.replace(/\s+/g, ' ').trim())
  if (!normalized) return '未命名调研'
  const researchTopic = normalized
    .split(/(?<=[。！？!?；;])\s*/u)
    .filter((clause) => !isDeliveryDirectiveClause(clause) && !isScopeMetadataLine(clause))
    .join('')
    .replace(/[。；;，,、]+$/u, '')
    .trim()
  if (researchTopic && !isScopePromptLeak(researchTopic)) return researchTopic
  const beforeSupplement = normalized.split(/[；;]\s*补充[:：]/u)[0]?.trim()
  if (beforeSupplement && !isScopePromptLeak(beforeSupplement)) return beforeSupplement
  const usefulLines = value
    .split(/\n+/)
    .map((line) => cleanFrameText(line))
    .filter((line): line is string => Boolean(line))
  const cleaned = usefulLines.join('；').replace(/\s+/g, ' ').trim()
  if (cleaned && !isScopePromptLeak(cleaned)) return cleaned
  return normalized.replace(/[；;]\s*补充[:：].*$/u, '').trim() || '未命名调研'
}

function stripInlineDeliveryMetadata(value: string): string {
  return value.replace(
    /(?:[，,]\s*)?(?:用途|用于|使用场景|受众|读者|面向|谁看|输出|格式|语言|文风|篇幅)\s*[:：]?[^。；;\n]*(?=[。；;\n]|$)/gu,
    ''
  ).replace(/\s*([；;])\s*\1+/gu, '$1').trim()
}

function isDeliveryDirectiveClause(value: string): boolean {
  return /^(?:不要|不需要|无需|无须|不必).{0,20}(?:提问|追问|选答|输出|生成|写|比较对象)|^(?:请)?(?:输出|生成|写成|返回|展示)/u.test(value.trim())
}

function questionPriority(input: {
  text: string
  index: number
  dimensions: string[]
}): ResearchFrame['coreQuestions'][number]['priority'] {
  if (input.dimensions.length > 0) {
    if (isDimensionQuestion(input.text, input.dimensions)) return 'high'
    return input.index === 0 ? 'high' : 'medium'
  }
  return input.index === 0 ? 'high' : input.index <= 4 ? 'medium' : 'low'
}

function questionRequired(input: {
  text: string
  index: number
  dimensions: string[]
}): boolean {
  if (input.index === 0) return true
  if (input.dimensions.length > 0) return isDimensionQuestion(input.text, input.dimensions)
  return false
}

function isDimensionQuestion(text: string, dimensions: string[]): boolean {
  return dimensions.some((dimension) => text.startsWith(`在「${dimension}」维度`))
}

function isMeaningfulDimension(value: string | undefined): value is string {
  const raw = value?.trim() ?? ''
  if (/\.{3}|…/u.test(raw)) return false
  if (/^(?:并)?与.+(?:对比|比较)$/u.test(raw)) return false
  if (/^(?:面向|受众|读者|语言|文风|篇幅|用途|输出格式|报告格式|决策用途|决策支持)/u.test(raw)) return false
  if (/普通读者|专业读者|通俗易懂|写作风格|中文报告|完整报告/u.test(raw)) return false
  if (/^(?:需?数据支撑|可追溯证据|明确结论|局限说明|引用要求|来源要求)$/u.test(raw)) return false
  if (/^(?:相互|关系|关联|联系|分别|各自)$/u.test(raw)) return false
  const normalized = value
    ?.replace(/^或/, '')
    .replace(/[？?。.,，；;:：\s]/g, '')
    .trim()
  return Boolean(
    normalized &&
    normalized.length >= 2 &&
    !isScopePromptLeak(value ?? '') &&
    !/(?:怎么|如何|哪个|哪家|谁|是否|什么)$/u.test(normalized)
  )
}

function assertNoScopePromptLeak(frame: ResearchFrame): void {
  const fields = [
    ['centralQuestion', frame.centralQuestion],
    ['coreResearchThread', frame.coreResearchThread],
    ...frame.coreQuestions.map((question) => [`coreQuestions.${question.id}`, question.text] as const)
  ] as Array<readonly [string, string]>
  for (const [field, value] of fields) {
    if (isScopePromptLeak(value)) {
      throw new ScopeFrameMappingError(`ResearchFrame.${field} contains a scope clarification prompt instead of a research question: ${value}`)
    }
  }
}

function isScopePromptLeak(value: string): boolean {
  return isScopeClarificationPrompt(value)
}
