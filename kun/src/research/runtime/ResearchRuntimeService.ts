/**
 * [INPUT]: 依赖 ResearchRuntime、ScopeAgent、ResearchRunRepository 和 core/presets 的预算解析
 * [OUTPUT]: 对外提供 ResearchRuntimeService 和 HTTP DTO，用于创建、确认、批准、查询、取消 research run
 * [POS]: research/runtime 的服务门面，连接 server routes 与 ResearchRuntime 编排核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { join } from 'node:path'
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
import { ResearchRuntime } from './ResearchRuntime.js'
import { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { DefaultResearchTaskWorker } from './DefaultResearchTaskWorker.js'
import { BasicScopeAgent, type ScopeAgent } from '../agents/ScopeAgent.js'
import type { ResearchTaskWorker, SynthesisWriter } from '../agents/types.js'
import { HeuristicQualityJudge, type QualityJudge } from '../verification/QualityJudge.js'

export type CreateResearchRunRequest = {
  topic: string
  workspaceRoot?: string
  autoApprove?: boolean
  reasoningEffort?: ResearchReasoningEffort
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
  artifactPaths: ResearchRun['artifacts']
  completed: boolean
}

export class ResearchRuntimeService {
  private readonly runtimesByRoot = new Map<string, ResearchRuntime>()
  private readonly runtimeByRunId = new Map<string, ResearchRuntime>()
  private readonly backgroundRunIds = new Set<string>()
  private readonly fallbackScopeAgent = new BasicScopeAgent()

  constructor(
    private readonly options: {
      dataDir: string
      nowIso?: () => string
      idGenerator?: () => string
      scopeAgent?: ScopeAgent
      worker?: ResearchTaskWorker
      synthesisWriter?: SynthesisWriter
      qualityJudge?: QualityJudge
    }
  ) {}

  async createRun(input: CreateResearchRunRequest): Promise<ResearchRunApiResponse> {
    const topic = input.topic.trim()
    if (!topic) throw new Error('topic is required')
    const runtime = this.runtimeForWorkspace(input.workspaceRoot)
    const nowIso = this.nowIso()
    const scope = await this.scopeAgent().assess({ topic, nowIso })
    const budget = resolveResearchBudget({
      ...input.budget,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {})
    })
    const run = await runtime.createRun({
      title: topic,
      scope,
      brief: buildResearchBrief({ topic, nowIso, scope, budget, userClarifications: [], overrides: input.brief }),
      frame: buildResearchFrame({ topic, scope, userClarifications: [], overrides: input.frame }),
      budget
    })
    this.runtimeByRunId.set(run.id, runtime)

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
    const nowIso = this.nowIso()
    const clarifications = [
      ...existing.scopeClarifications.map((item) => ({ message: item.message })),
      { message }
    ]
    const scope = await this.scopeAgent().assess({
      topic: existing.title || existing.brief.topic,
      clarifications,
      nowIso
    })
    const scopedTopic = buildClarifiedTopic(existing.title || existing.brief.topic, message, scope)
    const run = await runtime.answerScope(runId, {
      message,
      scope,
      brief: buildResearchBrief({
        topic: scopedTopic,
        nowIso,
        scope,
        budget: existing.budget,
        userClarifications: clarifications.map((item) => item.message)
      }),
      frame: buildResearchFrame({
        topic: scopedTopic,
        scope,
        userClarifications: clarifications.map((item) => item.message)
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

  async cancelRun(runId: string, reason?: string): Promise<ResearchRunApiResponse> {
    const runtime = this.mustRuntime(runId)
    const run = await runtime.cancelRun(runId, reason)
    return responseForRun(run)
  }

  private runtimeForWorkspace(workspaceRoot: string | undefined): ResearchRuntime {
    const root = normalizeWorkspaceRoot(workspaceRoot) || join(this.options.dataDir, 'research-runs')
    const existing = this.runtimesByRoot.get(root)
    if (existing) return existing
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot: root }),
      worker: this.options.worker ?? new DefaultResearchTaskWorker(),
      synthesisWriter: this.options.synthesisWriter,
      qualityJudge: this.options.qualityJudge ?? new HeuristicQualityJudge(),
      idGenerator: this.options.idGenerator ?? (() => `rr_${randomUUID()}`),
      nowIso: this.options.nowIso
    })
    this.runtimesByRoot.set(root, runtime)
    return runtime
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

function buildResearchBrief(input: {
  topic: string
  nowIso: string
  scope?: ResearchScopeAssessment
  budget?: ResearchBudget
  userClarifications?: string[]
  overrides?: Partial<ResearchBrief>
}): ResearchBrief {
  const userClarifications = input.overrides?.userClarifications ?? input.userClarifications ?? []
  return {
    id: input.overrides?.id ?? `brief_${hashId(input.topic)}`,
    version: input.overrides?.version ?? 1,
    topic: input.overrides?.topic ?? input.topic,
    userIntent: input.overrides?.userIntent ?? buildUserIntent(input.topic, input.scope),
    ...(userClarifications.length > 0 ? { userClarifications } : {}),
    targetAudience: input.overrides?.targetAudience,
    outputFormat: input.overrides?.outputFormat ?? 'Markdown 中文详细完整报告，默认不少于 2000 字，复杂主题按章节展开并保留可追溯引用',
    sourcePolicy: input.overrides?.sourcePolicy ?? {
      allowedSourceTypes: ['web', 'local_file'],
      minSourceCount: input.budget?.minSources ?? 5,
      maxSourceCount: input.budget?.maxSources ?? 16,
      requireCitations: true
    },
    successCriteria: input.overrides?.successCriteria ?? buildSuccessCriteria(input.scope, userClarifications),
    constraints: input.overrides?.constraints ?? [
      '优先使用 runtime 可抓取的网页来源；来源不足或抽取失败时，必须明确标注兜底资料卡和待复核限制。'
    ],
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
  const scopeText = [
    input.topic,
    input.scope?.summary,
    input.scope?.mainContradiction,
    ...(input.scope?.confirmationChecklist ?? []),
    ...(input.userClarifications ?? [])
  ].filter(Boolean).join('\n')
  const requiredDimensions = requiredDimensionsFromScopeText(scopeText)
  const coreQuestion = input.overrides?.centralQuestion ??
    coreQuestionFromScope(input.scope) ??
    centralQuestionFromScopeText(input.topic, scopeText, requiredDimensions)
  const coreResearchThread = input.overrides?.coreResearchThread
    ?? cleanFrameText(input.scope?.mainContradiction)
    ?? `围绕「${input.topic}」，抓住最能改变最终判断的证据，回答：${coreQuestion}`
  const coreQuestions = input.overrides?.coreQuestions ?? buildDefaultCoreQuestions({
    topic: input.topic,
    coreQuestion,
    coreResearchThread,
    requiredDimensions
  })
  const frame = {
    coreResearchThread,
    centralQuestion: coreQuestion,
    decisionToSupport: input.overrides?.decisionToSupport,
    targetUserOrActor: input.overrides?.targetUserOrActor,
    coreTask: input.overrides?.coreTask,
    currentPath: input.overrides?.currentPath,
    keyFriction: input.overrides?.keyFriction,
    interventionHypothesis: input.overrides?.interventionHypothesis,
    alternativesToCompare: input.overrides?.alternativesToCompare,
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
      '关键事实、指标、时间线或产品/市场数据，用于支撑主要判断。',
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
  assertNoScopePromptLeak(frame)
  return frame
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
        ...dimensions.map((dimension) => `在「${dimension}」维度上，关键事实、差距、优势和风险是什么？`),
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
  return uniqueQuestions.slice(0, 6).map((text, index) => ({
    id: `q${index + 1}`,
    text,
    priority: index <= 2 ? 'high' : index <= 4 ? 'medium' : 'low',
    required: index <= 2
  }))
}

function buildUserIntent(topic: string, scope: ResearchScopeAssessment | undefined): string {
  if (!scope || !scope.readyForBrief) {
    return `围绕「${topic}」生成一份有主线、有证据绑定、默认不少于 2000 字的完整调研报告。`
  }
  return `${scope.summary} 报告需要围绕这条主线展开，并产出默认不少于 2000 字的完整中文报告：${scope.mainContradiction}`
}

function buildSuccessCriteria(scope: ResearchScopeAssessment | undefined, userClarifications: string[] = []): string[] {
  const criteria = [
    '产出一份结构清晰、默认不少于 2000 字、带可追溯引用绑定的完整报告草稿。',
    '至少覆盖定义口径、关键事实、核心机制、反证边界和结论建议五类内容。',
    '保留机器可读的证据记录，方便后续接入真实来源和复核。'
  ]
  if (userClarifications.length > 0) {
    criteria.splice(1, 0, '报告必须显式覆盖用户在 scope 阶段补充的选项、文本要求和边界条件。')
  }
  if (scope?.readyForBrief) {
    criteria.splice(1, 0, `报告必须回应主要矛盾：${scope.mainContradiction}`)
  }
  return criteria
}

function coreQuestionFromScope(scope: ResearchScopeAssessment | undefined): string | undefined {
  if (!scope?.readyForBrief) return undefined
  const line = scope.confirmationChecklist.find((item) => item.includes('核心问题'))
  if (!line) return undefined
  const value = line.split(/[:：]/).slice(1).join('：').trim()
  return cleanFrameText(value)
}

function centralQuestionFromScopeText(topic: string, text: string, dimensions: string[]): string {
  const compact = text.replace(/\s+/g, '')
  const isChinaUs = /中美|中国.*美国|美国.*中国|China.*US|US.*China|China.*UnitedStates|UnitedStates.*China/i.test(text)
  if (isChinaUs && /综合实力|经济实力|宏观经济|产业结构|贸易|供应链|科技创新|数字经济|差距|优势|竞争力/.test(text)) {
    return '中美综合经济实力谁更强？主要领域差距、优势与商业/投资启示是什么？'
  }

  const explicitCore = labeledScopeValue(text, ['核心问题', '核心是', '主要目的', '目的'])
  const cleanedCore = cleanFrameText(explicitCore)
  if (cleanedCore) {
    if (/综合实力|差距|优势|风险|机会|竞争力|判断|决策|对比|比较/.test(cleanedCore)) {
      return cleanedCore.endsWith('？') || cleanedCore.endsWith('?') ? cleanedCore : `${cleanedCore}？`
    }
    return `围绕「${topic}」，${cleanedCore}`
  }

  if (dimensions.length > 0) {
    return `围绕「${topic}」，哪些维度最能改变最终判断？`
  }
  return `用户读完后应该真正理解「${topic}」的什么？`
}

function requiredDimensionsFromScopeText(text: string): string[] {
  const dimensions: string[] = []
  const push = (value: string) => {
    if (!dimensions.includes(value)) dimensions.push(value)
  }
  if (/宏观经济总量|经济总量|GDP|增速|通胀|就业/.test(text)) push('宏观经济总量与增速')
  if (/产业结构|产业链|制造业|服务业|竞争力|生产率/.test(text)) push('产业结构与竞争力')
  if (/贸易|供应链|进出口|关税|逆差|顺差|全球价值链/.test(text)) push('贸易与供应链')
  if (/科技创新|数字经济|研发|专利|AI|半导体|互联网|平台经济/.test(text)) push('科技创新与数字经济')
  if (/脱钩|去风险|投资|商业决策|商业启示|市场进入|配置|风险/.test(text)) push('脱钩风险与投资/商业启示')

  const labeledDimensions = labeledScopeValue(text, ['领域', '维度', '调研范围', '范围'])
  for (const part of labeledDimensions.split(/[、,，;；/]/).map((item) => cleanFrameText(item)).filter(Boolean)) {
    if (part && part.length <= 24 && !dimensions.includes(part)) dimensions.push(part)
  }
  return dimensions.slice(0, 5)
}

function labeledScopeValue(text: string, labels: string[]): string {
  const lines = text.split(/\n/)
  for (const line of lines) {
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
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || isScopePromptLeak(cleaned)) return undefined
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned
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
  return /您是否|你是否|请说明|请补充|待确认|等待用户|需要用户|希望对比.*哪个具体|哪个具体领域|主要受众是谁|时间范围是什么|是否有特定的比较角度|例如，是想了解/u.test(value)
}

function responseForRun(run: ResearchRun): ResearchRunApiResponse {
  return {
    run,
    reportPath: run.status === 'done' || (run.status === 'failed' && run.draftReportAvailable === true)
      ? run.artifacts.reportPath
      : null,
    artifactPaths: run.artifacts,
    completed: run.status === 'done'
  }
}

function normalizeWorkspaceRoot(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? ''
}

function buildClarifiedTopic(topic: string, message: string, scope?: ResearchScopeAssessment): string {
  const normalizedTopic = topic.trim()
  const normalizedMessage = message.trim()
  if (!normalizedMessage) return normalizedTopic
  if (scope?.readyForBrief && scope.summary.trim()) {
    if (!isGenericResearchTopic(normalizedTopic)) return normalizedTopic
    return shortTitle(scope.summary)
  }
  if (isGenericResearchTopic(normalizedTopic)) return normalizedMessage
  if (normalizedTopic.includes(normalizedMessage)) return normalizedTopic
  return `${normalizedTopic}；补充：${normalizedMessage}`
}

function isGenericResearchTopic(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return /^(帮我)?(做)?(研究|调研|分析|看看|了解)(一下)?[。！？!?\s]*$/.test(compact)
    || /^(这个|这个东西|它|他们|这件事|这个产品|这个项目)[。！？!?\s]*$/.test(compact)
    || /^research$/i.test(value.trim())
}

function hashId(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function shortTitle(value: string): string {
  const cleaned = value
    .replace(/^用户希望/, '')
    .replace(/^用户想要/, '')
    .replace(/[。！？!?\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned || value.slice(0, 48)
}
