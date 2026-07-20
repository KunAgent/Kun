/**
 * [INPUT]: 依赖 model-client 和运行级模型选择做 scope JSON 判断，依赖 clarifications 判断用户是否已补齐阻塞信息
 * [OUTPUT]: 对外提供支持当前 UI 模型/Provider 的 BasicScopeAgent、ModelScopeAgent、scope prompt/parser 和不依赖领域词表的显式需求 sufficiency gate
 * [POS]: research/agents 的需求澄清入口；只负责决定能否进入 brief，不参与证据收集或报告写作，也不得创造原题之外的报告义务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { validateResearchScopeAssessment } from '../core/validation.js'
import type { ResearchModelUsageRecord, ResearchScopeAssessment, ResearchScopeClarification, ResearchScopeQuestion } from '../core/types.js'

export type ScopeAgentInput = {
  topic: string
  clarifications?: Array<Pick<ResearchScopeClarification, 'message'>>
  pendingQuestions?: ResearchScopeQuestion[]
  nowIso: string
  model?: string
  providerId?: string
}

export interface ScopeAgent {
  assess(input: ScopeAgentInput): ResearchScopeAssessment | Promise<ResearchScopeAssessment>
}

export const MODEL_SCOPE_AGENT_TIMEOUT_MS = 45_000

export const MODEL_SCOPE_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的 scope agent。',
  '你的任务不是开始调研，也不是写简报或报告，而是先理解用户真实需求，判断是否足够进入调研简报。',
  '必须抓住本次调研的主要矛盾：一条能组织后续证据收集和报告结构的核心主线。',
  'summary、mainContradiction、confirmationChecklist 只能转述原始需求和用户补充中明确提出的对象、关系、比较、场景与边界；不得自行增加“权衡、影响、导致、适用性、最佳策略”等用户没有提出的判断或研究义务。',
  '只有当调研对象、用户真正想搞懂的核心问题、用途/受众/边界基本明确时，readyForBrief 才能为 true。',
  '如果请求含糊、只有代词、只有“研究一下/分析一下”、范围过大或核心问题不明，readyForBrief 必须为 false，并一次性提出所有会阻塞简报的问题。',
  '默认输出中文完整报告，篇幅服从问题复杂度和证据密度；用户明确要求简洁或详细时必须遵循。默认需要可追溯引用、局限和不确定性，不要为这些默认项反复追问。',
  '所有内容使用中文。只返回 JSON，不要 Markdown，不要解释。'
].join('\n')

export class BasicScopeAgent implements ScopeAgent {
  assess(input: ScopeAgentInput): ResearchScopeAssessment {
    const topic = normalizeTopic(input.topic)
    const clarificationText = normalizeTopic(input.clarifications?.map((item) => item.message).join(' ') ?? '')
    const effectiveText = effectiveScopeText(topic, clarificationText)
    const issues = assessTopicIssues(effectiveText)
    const readyForBrief = issues.length === 0
    return {
      understood: readyForBrief,
      coreQuestionsConfirmed: readyForBrief,
      readyForBrief,
      assessmentSource: 'deterministic_fallback',
      summary: readyForBrief
        ? `我理解你要围绕「${effectiveText}」做一份完整调研报告，并优先抓住最能解释问题的主线。`
        : `当前调研请求「${effectiveText}」还不足以进入简报，需要先补齐对象、目标和边界。`,
      mainContradiction: readyForBrief
        ? `围绕「${effectiveText}」，先抓住最影响结论的核心矛盾，再沿着证据链展开。`
        : '当前主要矛盾不是资料不足，而是调研对象、决策目标或输出边界还不够明确。',
      assumptions: readyForBrief
        ? [
            '默认输出中文完整报告。',
            '默认信息密度优先，不用固定字数判断报告质量。',
            '默认优先调研用户真正需要理解或决策的核心路径。',
            '默认用可追溯证据支撑关键论断。'
          ]
        : [
            '不会在需求不清楚时直接开始写报告。',
            '需要先确认调研对象、核心问题和使用场景。'
          ],
      clarificationQuestions: issues,
      confirmationChecklist: readyForBrief
        ? [
            `需求理解：围绕「${effectiveText}」生成中文完整调研报告。`,
            '核心问题：报告要回答一个最关键的问题，而不是堆资料。',
            '调研主线：先找主要矛盾，再展开证据链和分支问题。',
            '输出边界：默认保留局限、不确定性和引用绑定。'
          ]
        : [
            '需求理解：等待用户补充后再确认。',
            '核心问题：等待用户明确最想搞懂的问题。',
            '调研主线：等待用户确认后再生成。',
            '输出边界：等待用户确认用途、受众或范围。'
          ],
      createdAt: input.nowIso
    }
  }
}

export class ModelScopeAgent implements ScopeAgent {
  private readonly fallback: ScopeAgent

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: ScopeAgent
    }
  ) {
    this.fallback = options.fallback ?? new BasicScopeAgent()
  }

  async assess(input: ScopeAgentInput): Promise<ResearchScopeAssessment> {
    const model = input.model?.trim() || this.options.model
    const providerId = input.providerId?.trim()
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_SCOPE_AGENT_TIMEOUT_MS)
    )

    const turnId = `research_scope_${hashScopeInput(input)}`
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    try {
      const request: ModelRequest = {
        threadId: 'research_scope',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_SCOPE_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_scope',
            turnId,
            text: buildModelScopePrompt(input)
          })
        ],
        tools: [],
        stream: false,
        maxTokens: 1_400,
        temperature: 0,
        responseFormat: 'json_object',
        reasoningEffort: 'off',
        abortSignal: controller.signal
      }
      const collected = await collectScopeModelText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const scope = parseModelScopeAssessment(collected.text, {
        nowIso: input.nowIso,
        model
      })
      const normalized = applyScopeSufficiencyGate(scope, input)
      validateResearchScopeAssessment(normalized)
      const modelUsage = collected.usage.slice(-1).map((usage) => ({
        stage: 'scope' as const,
        model,
        turnId,
        usage
      }))
      return { ...normalized, ...(modelUsage.length > 0 ? { modelUsage } : {}) }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('unknown_provider_id:')) throw error
      const fallback = await this.fallbackAssessment(input)
      const lastUsage = observedUsage.at(-1)
      return lastUsage ? {
        ...fallback,
        modelUsage: [{ stage: 'scope', model, turnId, usage: lastUsage }]
      } : fallback
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fallbackAssessment(input: ScopeAgentInput): Promise<ResearchScopeAssessment> {
    const scope = await this.fallback.assess(input)
    return {
      ...scope,
      assessmentSource: 'deterministic_fallback',
      assessmentModel: input.model?.trim() || this.options.model
    }
  }
}

export function buildModelScopePrompt(input: ScopeAgentInput): string {
  const clarifications = input.clarifications?.length
    ? input.clarifications.map((item, index) => `${index + 1}. ${item.message}`).join('\n')
    : '暂无'
  return [
    '请对下面的 DeepResearch 请求做 scope 确认。',
    `当前日期：${input.nowIso.slice(0, 10)}`,
    '所有“当前、最近、过去 N 年”等相对时间范围必须以上述当前日期为基准，不得沿用模型知识截止时间。',
    '',
    '原始需求：',
    input.topic,
    '',
    '用户已补充：',
    clarifications,
    '',
    '返回 JSON schema：',
    '{',
    '  "understood": boolean,',
    '  "coreQuestionsConfirmed": boolean,',
    '  "readyForBrief": boolean,',
    '  "summary": "一句话说明你理解的需求",',
    '  "mainContradiction": "本次调研最应该抓住的主要矛盾/主线",',
    '  "assumptions": ["仍需用户知道的默认假设"],',
    '  "clarificationQuestions": [',
    '    { "id": "scope_target", "question": "需要用户补充的问题", "why": "为什么必须确认", "options": ["选项A", "选项B"], "required": true }',
    '  ],',
    '  "confirmationChecklist": ["需求理解：...", "核心问题：...", "调研主线：...", "输出边界：..."]',
    '}',
    '',
    '约束：',
    '- 如果 readyForBrief=false，clarificationQuestions 必须包含 1 到 5 个问题。',
    '- 如果 readyForBrief=false，优先一次性问完所有关键阻塞问题；不要把可默认的问题留到第二轮。',
    '- 如果确实需要追问，可提出最多 5 个问题；少问但不要漏掉会影响报告方向的核心问题。',
    '- 如果 readyForBrief=true，clarificationQuestions 可以为空，但 confirmationChecklist 必须让用户能确认需求理解、核心问题、主线和输出边界。',
    '- 问题要具体，优先让用户补齐：调研对象、核心问题、使用场景/受众、范围边界、比较对象或决策目标。',
    '- 默认输出中文完整报告，篇幅服从问题复杂度和证据密度；用户明确要求简洁或详细时必须遵循。不要把“是否详细”作为追问问题。',
    '- mainContradiction 只能概括原始需求和用户补充中已经明确提出的主线，不得创造新的因果、权衡、适用性或场景判断。',
    '- 不要把简报、调研计划或报告正文放进这个 JSON。'
  ].join('\n')
}

export function parseModelScopeAssessment(
  raw: string,
  input: { nowIso: string; model: string }
): ResearchScopeAssessment {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('Model scope response did not contain JSON')
  const value = JSON.parse(json) as Record<string, unknown>
  const readyForBrief = booleanValue(value.readyForBrief) ?? false
  const understood = booleanValue(value.understood) ?? readyForBrief
  const coreQuestionsConfirmed = booleanValue(value.coreQuestionsConfirmed) ?? readyForBrief
  const clarificationQuestions = normalizeQuestions(value.clarificationQuestions)
  const confirmationChecklist = readyForBrief
    ? normalizeStringArray(value.confirmationChecklist, 8)
    : pendingScopeChecklist(clarificationQuestions)
  const assumptions = normalizeStringArray(value.assumptions, 8)
  const summary = stringValue(value.summary)
  const mainContradiction = stringValue(value.mainContradiction)

  return {
    understood,
    coreQuestionsConfirmed,
    readyForBrief,
    assessmentSource: 'model',
    assessmentModel: input.model,
    summary: summary || (readyForBrief
      ? '模型已理解本次 DeepResearch 需求，可以请用户确认后生成简报。'
      : '模型认为当前需求还不足以进入简报，需要先补充确认。'),
    mainContradiction: mainContradiction || '需要先确认本次调研的核心主线，再展开证据收集。',
    assumptions: assumptions.length ? assumptions : [
      '默认输出中文完整报告。',
      '默认信息密度优先，不用固定字数判断报告质量。',
      '默认先确认核心问题和范围边界，再进入简报。'
    ],
    clarificationQuestions,
    confirmationChecklist: confirmationChecklist.length ? confirmationChecklist : [
      '需求理解已经明确。',
      '核心问题已经明确。',
      '调研主线已经明确。',
      '输出边界已经明确。'
    ],
    createdAt: input.nowIso
  }
}

export function applyScopeSufficiencyGate(
  scope: ResearchScopeAssessment,
  input: ScopeAgentInput
): ResearchScopeAssessment {
  if (scope.readyForBrief) return scope
  const rawClarificationText = input.clarifications?.map((item) => item.message).join('\n') ?? ''
  const clarificationText = normalizeTopic(rawClarificationText)
  const effectiveText = effectiveScopeText(normalizeTopic(input.topic), clarificationText)
  if (assessTopicIssues(effectiveText).length === 0) {
    return markScopeReady(scope)
  }
  if (!clarificationText) return scope
  if (allPendingRequiredQuestionsAnswered(input.pendingQuestions, input.clarifications?.at(-1)?.message ?? '')) {
    return markScopeReady(scope)
  }
  if (scope.clarificationQuestions.length > 0 && scope.clarificationQuestions.every((question) => !question.required)) {
    return markScopeReady(scope)
  }
  if (!hasSufficientClarification(clarificationText)) return scope
  return markScopeReady(scope)
}

function markScopeReady(scope: ResearchScopeAssessment): ResearchScopeAssessment {
  const summary = scope.summary || '调研对象和核心问题已经明确，可以进入简报。'
  const mainContradiction = scope.mainContradiction || '围绕已确认核心问题组织调研主线，并用证据链解释关键差异和未来影响。'
  return {
    ...scope,
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    clarificationQuestions: [],
    confirmationChecklist: [
      `需求理解：${summary}`,
      `核心问题：${mainContradiction}`,
      `调研主线：${mainContradiction}`,
      '输出边界：按原始需求及已确认补充中的受众、用途、时间范围和报告要求执行。'
    ]
  }
}

function allPendingRequiredQuestionsAnswered(
  pendingQuestions: ResearchScopeQuestion[] | undefined,
  latestMessage: string
): boolean {
  if (!pendingQuestions) return false
  const requiredQuestions = pendingQuestions.filter((question) => question.required)
  if (requiredQuestions.length === 0) return latestMessage.trim().length > 0
  const blocks = latestMessage.split(/\n\s*\n/u)
  return requiredQuestions.every((question) => blocks.some((block) =>
    block.includes(question.question) && /(^|\n)\s*(?:回答|答复)[:：]\s*(?!未选择|未回答|跳过)\S+/u.test(block)
  ))
}

async function collectScopeModelText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal,
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
): Promise<{ text: string; usage: ResearchModelUsageRecord['usage'][] }> {
  let text = ''
  const usage: ResearchModelUsageRecord['usage'][] = []
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('scope model timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'usage') {
      usage.push(chunk.usage)
      onUsage?.(chunk.usage)
    }
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('scope model returned empty text')
  return { text, usage }
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function normalizeQuestions(value: unknown): ResearchScopeQuestion[] {
  if (!Array.isArray(value)) return []
  const questions: ResearchScopeQuestion[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue
    const question = stringValue(item.question)
    const why = stringValue(item.why)
    if (!question || !why) continue
    let id = sanitizeQuestionId(stringValue(item.id) || `scope_${index + 1}`)
    while (seen.has(id)) id = `${id}_${index + 1}`
    seen.add(id)
    const options = normalizeStringArray(item.options, 4)
    questions.push({
      id,
      question,
      why,
      options: options.length ? options : ['直接补充说明', '使用默认边界继续'],
      required: booleanValue(item.required) ?? true
    })
  }
  return questions.slice(0, 5)
}

function pendingScopeChecklist(questions: ResearchScopeQuestion[]): string[] {
  const checklist = [
    '需求理解：等待用户补充后再确认。',
    '核心问题：等待用户明确最想搞懂的问题。',
    '调研主线：等待用户确认后再生成。',
    '输出边界：等待用户确认用途、受众或范围。'
  ]
  for (const question of questions) {
    checklist.push(`待确认：${question.question}`)
  }
  return checklist.slice(0, 8)
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit)
}

function hasSufficientClarification(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  const hasTopicAnchor = /[\p{L}\p{N}]{2,}/u.test(compact)
  const hasCoreQuestion = /核心|目的|搞懂|解决|理解|预测|趋势|原因|差异|影响|判断|决策|风险|机会|why|how/i.test(text)
  const hasAudienceOrUse = /受众|场景|报告|文章|公众|读者|内容创作|学术|商业|政策|个人|中文|输出/i.test(text)
  const hasBoundary = /时间|范围|边界|最近|近[一二三四五六七八九十0-9]+年|当前|最新|20[0-9]{2}|不限|地区|国家|数据/i.test(text)
  return compact.length >= 40 && hasTopicAnchor && hasCoreQuestion && hasAudienceOrUse && hasBoundary
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeQuestionId(id: string): string {
  const normalized = id.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'scope_question'
}

function hashScopeInput(input: ScopeAgentInput): string {
  const text = `${input.topic}\n${input.clarifications?.map((item) => item.message).join('\n') ?? ''}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function assessTopicIssues(topic: string): ResearchScopeQuestion[] {
  const questions: ResearchScopeQuestion[] = []
  const compact = topic.replace(/\s+/g, '')
  const genericOnly = isGenericTopic(topic)
  const pronounOnly = isPronounTopic(topic)
  if (genericOnly || pronounOnly || compact.length < 4) {
    questions.push({
      id: 'scope_target',
      question: '你想调研的具体对象是什么？',
      why: '没有明确对象时，后续搜索、证据判断和报告结构都会发散。',
      options: ['一个明确对象', '一组需要比较的对象', '一个需要解释的问题', '一个需要支持的决策'],
      required: true
    })
  }

  const hasQuestionSignal = /为什么|如何|是否|解释|机制|原理|关系|作用|对比|区别|差异|优劣|风险|机会|路径|用户|成本|定价|商业模式|竞品|趋势|原因|影响|可行|怎么|what|why|how|compare|explain|vs|versus/i.test(topic)
  if (!hasQuestionSignal) {
    questions.push({
      id: 'scope_core_question',
      question: '你最想通过这次调研搞懂的核心问题是什么？',
      why: 'DeepResearch 需要一条主线，否则会变成泛泛资料汇总。',
      options: ['解释原因', '辅助决策', '比较方案', '判断机会/风险'],
      required: true
    })
  }

  const broadOnly = !hasQuestionSignal && compact.length >= 2 && compact.length <= 12
  if (broadOnly) {
    questions.push({
      id: 'scope_boundary',
      question: '这次调研的边界是什么？',
      why: '对象过宽会导致报告无法形成可验证结论。',
      options: ['限定一个地区/时间范围', '限定一个用户群体', '限定一个业务环节', '限定 2-4 个比较对象'],
      required: true
    })
  }

  return dedupeQuestions(questions)
}

function dedupeQuestions(questions: ResearchScopeQuestion[]): ResearchScopeQuestion[] {
  const seen = new Set<string>()
  return questions.filter((question) => {
    if (seen.has(question.id)) return false
    seen.add(question.id)
    return true
  })
}

function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ')
}

function effectiveScopeText(topic: string, clarificationText: string): string {
  if (!clarificationText) return topic
  if (isGenericTopic(topic) || isPronounTopic(topic)) return clarificationText
  if (topic.includes(clarificationText)) return topic
  return normalizeTopic(`${topic} ${clarificationText}`)
}

function isGenericTopic(topic: string): boolean {
  const compact = topic.replace(/\s+/g, '')
  return /^(帮我)?(做)?(研究|调研|分析|看看|了解)(一下)?[。！？!?\s]*$/.test(compact)
    || /^research$/i.test(topic.trim())
}

function isPronounTopic(topic: string): boolean {
  const compact = topic.replace(/\s+/g, '')
  return /^(这个|这个东西|它|他们|这件事)[。！？!?\s]*$/.test(compact)
}
