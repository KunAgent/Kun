import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { validateResearchScopeAssessment } from '../core/validation.js'
import type { ResearchScopeAssessment, ResearchScopeClarification, ResearchScopeQuestion } from '../core/types.js'

export type ScopeAgentInput = {
  topic: string
  clarifications?: Array<Pick<ResearchScopeClarification, 'message'>>
  nowIso: string
}

export interface ScopeAgent {
  assess(input: ScopeAgentInput): ResearchScopeAssessment | Promise<ResearchScopeAssessment>
}

export const MODEL_SCOPE_AGENT_TIMEOUT_MS = 45_000

export const MODEL_SCOPE_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的 scope agent。',
  '你的任务不是开始调研，也不是写简报或报告，而是先理解用户真实需求，判断是否足够进入调研简报。',
  '必须抓住本次调研的主要矛盾：一条能组织后续证据收集和报告结构的核心主线。',
  '只有当调研对象、用户真正想搞懂的核心问题、用途/受众/边界基本明确时，readyForBrief 才能为 true。',
  '如果请求含糊、只有代词、只有“研究一下/分析一下”、范围过大或核心问题不明，readyForBrief 必须为 false，并一次性提出所有会阻塞简报的问题。',
  '除非用户明确要求基础版，否则默认输出详细中文报告；默认需要可追溯引用、关键指标、局限和不确定性，不要为这些默认项反复追问。',
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
            '默认输出详细版而不是基础版报告。',
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
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_SCOPE_AGENT_TIMEOUT_MS)
    )

    try {
      const turnId = `research_scope_${hashScopeInput(input)}`
      const request: ModelRequest = {
        threadId: 'research_scope',
        turnId,
        model: this.options.model,
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
      const raw = await collectScopeModelText(this.options.modelClient.stream(request), controller.signal)
      const scope = parseModelScopeAssessment(raw, {
        nowIso: input.nowIso,
        model: this.options.model
      })
      const normalized = applyScopeSufficiencyGate(scope, input)
      validateResearchScopeAssessment(normalized)
      return normalized
    } catch {
      return this.fallbackAssessment(input)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fallbackAssessment(input: ScopeAgentInput): Promise<ResearchScopeAssessment> {
    const scope = await this.fallback.assess(input)
    return {
      ...scope,
      assessmentSource: 'deterministic_fallback'
    }
  }
}

export function buildModelScopePrompt(input: ScopeAgentInput): string {
  const clarifications = input.clarifications?.length
    ? input.clarifications.map((item, index) => `${index + 1}. ${item.message}`).join('\n')
    : '暂无'
  return [
    '请对下面的 DeepResearch 请求做 scope 确认。',
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
    '- 默认输出为详细中文报告，除非用户明确要求基础版；不要把“是否详细”作为追问问题。',
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
      '默认输出详细版而不是基础版报告。',
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
  if (!clarificationText || !hasSufficientClarification(clarificationText)) return scope
  const summary = scope.summary || `用户已补充清楚「${input.topic}」的调研对象、核心问题、用途/受众和时间边界。`
  const mainContradiction = scope.mainContradiction || '围绕已确认核心问题组织调研主线，并用证据链解释关键差异和未来影响。'
  return {
    ...scope,
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    clarificationQuestions: [],
    confirmationChecklist: [
      `需求理解：${summary}`,
      `核心问题：${deriveCoreQuestionFromClarification(rawClarificationText, mainContradiction)}`,
      `调研主线：${mainContradiction}`,
      '输出边界：按用户补充的受众、用途、时间范围和中文完整报告要求执行。'
    ]
  }
}

async function collectScopeModelText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('scope model timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('scope model returned empty text')
  return text
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
  const hasDomain = /领域|维度|对象|经济|贸易|科技|军事|教育|行业|产品|公司|论文|方案|china|us|美国|中国/i.test(text)
  const hasCoreQuestion = /核心|目的|搞懂|解决|理解|预测|趋势|原因|差异|影响|判断|决策|风险|机会|why|how/i.test(text)
  const hasAudienceOrUse = /受众|场景|报告|文章|公众|读者|内容创作|学术|商业|政策|个人|中文|输出/i.test(text)
  const hasBoundary = /时间|范围|边界|最近|近[一二三四五六七八九十0-9]+年|当前|最新|20[0-9]{2}|不限|地区|国家|数据/i.test(text)
  return compact.length >= 40 && hasDomain && hasCoreQuestion && hasAudienceOrUse && hasBoundary
}

function deriveCoreQuestionFromClarification(text: string, fallback: string): string {
  const coreLine = text
    .split(/\n/)
    .map((line) => line.trim())
    .find((line) => /核心|搞懂|解决|预测|趋势|判断/.test(line) && /补充|核心|搞懂|解决/.test(line) && line.length > 8)
  if (coreLine) {
    return shortScopeLine(coreLine.replace(/^补充[:：]\s*/, '').replace(/^选择[:：]\s*/, ''))
  }
  return fallback
}

function shortScopeLine(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}...` : cleaned
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
  const lower = topic.toLowerCase()
  const genericOnly = isGenericTopic(topic)
  const pronounOnly = isPronounTopic(topic)
  if (genericOnly || pronounOnly || compact.length < 4) {
    questions.push({
      id: 'scope_target',
      question: '你想调研的具体对象是什么？',
      why: '没有明确对象时，后续搜索、证据判断和报告结构都会发散。',
      options: ['一个具体产品或公司', '一个行业/赛道', '一个技术方案或论文', '一个用户问题或业务决策'],
      required: true
    })
  }

  const hasQuestionSignal = /为什么|如何|是否|对比|差异|优劣|风险|机会|路径|用户|成本|定价|商业模式|竞品|趋势|原因|影响|可行|怎么|what|why|how|compare|vs|versus/i.test(topic)
  if (!hasQuestionSignal) {
    questions.push({
      id: 'scope_core_question',
      question: '你最想通过这次调研搞懂的核心问题是什么？',
      why: 'DeepResearch 需要一条主线，否则会变成泛泛资料汇总。',
      options: ['解释原因', '辅助决策', '比较方案', '判断机会/风险'],
      required: true
    })
  }

  const broadTerms = ['ai', '人工智能', '大模型', '市场', '行业', '创业', '投资', '产品', '互联网']
  const broadOnly = broadTerms.some((term) => lower === term || compact === term)
    || /^(研究|调研|分析|看看|了解)(ai|人工智能|大模型|市场|行业|创业|投资|产品|互联网)$/i.test(compact)
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
  return /^(这个|这个东西|它|他们|这件事|这个产品|这个项目)[。！？!?\s]*$/.test(compact)
}
