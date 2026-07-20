/**
 * [INPUT]: 依赖 model-client、运行级模型选择、core/types 和 evidence/types 中的报告、预算、证据与引用数据
 * [OUTPUT]: 对外提供支持当前模型/Provider 的单次 QualityJudge、共享章节论证审计、可审计逐 occurrence 引用问题，以及让错引、重复、乱码、残句、破损结构、低于需求/核心回答灾难下限和本地深度提醒与 Judge 同时确认的薄弱必答章节阻止发布的 verdict 合并函数
 * [POS]: research/verification 的 LLM-as-judge 节点，负责提供语义质量评分和少量可定位的发布阻塞项；可用性与单独主观分数不覆盖本地确定性质量门，但本地与 Judge 对同一薄弱章节达成一致时不得把临界分数抬到通过线
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { researchReasoningForStage } from '../core/presets.js'
import { reportArgumentSignals } from '../core/report-argument.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type {
  QualityJudgeVerdict,
  QualityJudgeIssue,
  QualityVerdict,
  ResearchBrief,
  ResearchBudget,
  ResearchExecutionControl,
  ResearchFrame,
  ResearchModelUsageRecord,
  ResearchPlan,
  ResearchReportBlueprint,
  ResearchScopeAssessment
} from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import { isResearchTextRelevant, uniqueEligibleEvidenceSources } from '../evidence/EvidenceEligibility.js'
import { hasExplicitEvidenceGapBoundary, splitCitationSentences } from '../evidence/CitationProximity.js'

export type QualityJudgeInput = {
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
  plan: ResearchPlan
  budget: ResearchBudget
  reportMarkdown: string
  sources: SourceRecord[]
  notes: ResearchNote[]
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  citations: CitationBinding[]
  deterministicVerdict: QualityVerdict
  reportBlueprint?: ResearchReportBlueprint
  previousVerdict?: QualityVerdict
  execution?: ResearchExecutionControl
  nowIso: string
}

export interface QualityJudge {
  judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict>
}

export const MODEL_QUALITY_JUDGE_TIMEOUT_MS = 90_000
const MIN_JUDGE_OVERALL_PASS = 0.65
const MIN_JUDGE_CORE_PASS = 0.65
const MIN_JUDGE_COMPLETENESS_PASS = 0.6
const MIN_JUDGE_EVIDENCE_PASS = 0.6
const MIN_JUDGE_CITATION_PASS = 0.75
const MIN_JUDGE_WRITING_PASS = 0.6

type JudgeThresholds = {
  overall: number
  core: number
  completeness: number
  evidence: number
  citation: number
  writing: number
}

function judgeThresholds(preset: ResearchBudget['preset'] = 'standard'): JudgeThresholds {
  if (preset === 'deep') {
    return {
      overall: 0.8,
      core: 0.75,
      completeness: 0.75,
      evidence: 0.75,
      citation: 0.85,
      writing: 0.75
    }
  }
  return {
    overall: MIN_JUDGE_OVERALL_PASS,
    core: MIN_JUDGE_CORE_PASS,
    completeness: MIN_JUDGE_COMPLETENESS_PASS,
    evidence: MIN_JUDGE_EVIDENCE_PASS,
    citation: MIN_JUDGE_CITATION_PASS,
    writing: MIN_JUDGE_WRITING_PASS
  }
}

export const MODEL_QUALITY_JUDGE_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的 LLM Judge。',
  '你的任务是按已确认需求、ResearchBrief、ResearchFrame、证据与引用，对最终报告做严格评分。',
  '需求义务必须能逐字追溯到 ResearchBrief.topic、用户补充或已确认 coreQuestions；Scope 的模型 summary/mainContradiction、evidenceNeeded 和 Judge 自己提出的细分项只能辅助理解，不能创造新的用户必答项。',
  '不要评价模型是否努力，也不要泛泛说“不错”；必须指出报告是否真正回应了用户确认的需求和核心研究主线。',
  '重点评估：需求匹配、是否回答核心问题、是否遵循 ResearchFrame、报告完整度、证据使用、引用忠实度、不确定性校准、写作质量。',
  '报告完整度不能只按标题、篇幅或引用数量判断；每个核心章节必须包含局部结论、关键证据解释、从证据到结论的推理，以及成立条件、反证或适用边界。',
  '输入中的章节结构审计只用于确认每章是否实际包含段落、引用、综合推理和边界；仍需阅读各章正文判断这些内容是否有实质，但不得声称结构审计明确存在的段落或边界完全缺失。',
  '如果认为某章的综合或边界只有形式没有实质，必须点名该章节并在 unsupportedFragment 中引用具体句子；不得用“所有章节”“整个报告”或“hasEvidenceSynthesis 全为 false”替代逐章审计。',
  '用户要求“简洁”只允许删除重复和空话，不能删减研究维度或把核心章节写成一两句事实摘要；出现这种情况时 writingQuality 必须低于通过线并给出 blocking writing issue。',
  '报告的“摘要”和“调研范围与方法”由 Runtime 后置生成，应该很短；不要因为它们短而扣分，也不要要求单独的证据来源列表。',
  '摘要提炼正文核心判断、结论简短回扣摘要都属于正常报告结构；只有同一事实在“主要发现”的多个章节内无分析价值地重复，才可判为阻塞性重复，且 unsupportedFragment 必须给出该重复原句。',
  '上一轮未通过项只是复核清单，不是本轮事实；必须在当前报告中重新定位 unsupportedFragment，已经删除或改写的问题不得原样复制到本轮 issues。',
  '用户点名的场景若没有场景直证，报告可以把已引用机制明确写成条件分析并承认缺口；不得要求报告用证据链之外的性能影响、实现方案、版本策略或最佳实践填满场景章节。',
  '若声称某个章节“只堆砌事实”“没有真正分析”或“缺乏实质综合”，必须在 unsupportedFragment 中给出该章节的具体原句；没有原句的空泛否决不构成 blocking issue。',
  '必须逐句寻找写作与事实边界问题：抓取文本粘连成无标点长句、残句、重复事实、矛盾连接词，以及正文凭空加入的实现机制、例子、技术名词或最佳实践，均不能因章节有引用就忽略。',
  '“因此”“关键在于”“这意味着”等连接词不自动使句子成为安全推理；若句子新增输入证据链未支撑的实现行为、基础设施、版本机制、具体例子或行动建议，必须作为 blocking evidence/writing issue。',
  '不得把由句号、分号或 Markdown 分段明确分开的相邻句子误报为“无标点粘连”；只有报告原文确实缺少句末边界时才能给出该问题。',
  '若出现上述明显病句或无依据技术扩写，writingQuality 不得达到 0.60，overall 不得达到 0.65，pass 必须为 false。',
  '如果报告忽略核心研究主线、没有回答核心问题、引用支撑不足，必须降低分数。',
  '逐项比较报告引用句、citedClaims 和 citedEvidenceSpans；引用存在不代表引用忠实，正文新增的价格、比例、日期、数量、倍数或确定阈值若未出现在证据链中，必须判为阻塞问题。',
  '不得把证据中没有明确主体的“某一个/某一家”或“a/an unnamed subject”描述自行归到研究对象；报告补出的主体必须能在同一 occurrence 的 claim 或 evidence span 中直接找到。',
  '判断引用忠实度时必须优先查看 citationEvidenceChains 中同一 citation 的报告句、claim 和原文片段；允许语义等价的准确转述，不得因为中英文或措辞不同误判为无依据。',
  '允许报告分析多条已引用事实之间的关系、差异和权衡；只要推理没有新增实体、数字、例子、实现机制、适用对象或因果结果，就不能因为该关系没有在单条原文中逐字出现而判为无依据。',
  '报告说明“现有证据未覆盖某种实现、对象或场景”是在校准结论边界，不是需要外部引用的新事实；只要没有顺带断言该对象的实际行为，就不得判为无依据技术扩写。边界句若机械重复，可以作为写作文风问题，但不能伪装成证据不忠实。',
  '章节已用引用事实和综合回答用户确认维度后，边界句明确承认某个细分原因、触发因素或影响机制未被证据解释，属于诚实校准；除非该细分项在用户原题或确认范围中被明确要求，否则不得反向要求报告凭空补写并判为 incomplete_synthesis。',
  '如果 Research coverage outcome 把某章标为 evidence_gap，表示针对该问题的补研已经没有新增可回答事实；只要该章明确说明无法形成可靠结论、没有拿背景或错位数据冒充答案，就应视为诚实回答而不是要求继续虚构或重复搜索。',
  '同一 displayId 表示同一 canonical 来源，可以有多个 occurrence；一个 occurrence 也可以由多个 claimIds 和 evidenceSpans 共同支持。必须按 occurrence 的完整证据包核验 reportClaimText，不得拆成单个 claim 后否定复合综合句。',
  '引用忠实度允许正常翻译和同义改写；只要主体、动作、条件和结果保持一致，不得因为中英文或措辞不同就判定不忠实。',
  '在声称原文缺少某个地点、数字、对象或结果前，必须重新检查该 occurrence 的全部 evidenceSpans；如果原文明确出现同一事实，不得输出 citation_unfaithful。',
  '相同 canonical URL 或相同页面的重复抓取不算独立来源；不要因为同一页面被多个 task 重复引用就提高证据使用或来源质量评分。',
  '发布方自述可以证明“该发布方如何描述自身意图或结果”；若报告已明确标注这是自述且未获独立验证，缺少独立材料只能作为来源质量警告，不能误报为 citation_unfaithful，除非 sourcePolicy 或 CoverageContract 明确要求独立来源。',
  '不得自行发明“至少三篇”“至少五篇”等来源数量门槛；来源数量只能依据用户确认的 sourcePolicy、预算中的 minSources 和 CoverageContract。用户限定官方文档且少量权威页面已直接覆盖核心定义时，应按覆盖与忠实度评分，不能仅因来源少而扣分。',
  '建议可以是综合推断，但若使用“唯一”“一定”“完全没有优势”等绝对表述，必须有直接证据和清楚的适用边界，否则降低引用忠实度与写作质量。',
  'standard/deep 报告必须使用真实抓取、可定位且通过证据准入的来源；模型生成资料卡、synthetic、search-only 或 fallback_extracted 内容不能作为通过依据。',
  'sourceType=web 和 web_fetch 标签本身不代表强证据；必须结合抓取状态、来源可靠性、正文片段和引用绑定判断。',
  '如果报告把待复核、合成或搜索摘要资料伪装成真实外部检索结果，必须判为不通过。',
  '最多返回 4 个 issues、4 个 warnings 和 4 个 recommendedFixes；每条只写一个短句，整个 JSON 控制在 1200 tokens 内，必须优先保证 JSON 完整闭合。',
  '所有评分为 0 到 1 的数字。只返回 JSON，不要 Markdown。'
].join('\n')

export class HeuristicQualityJudge implements QualityJudge {
  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    const verdict = heuristicJudge(input, input.nowIso, 'heuristic_fallback')
    if (input.budget.preset === 'quick') return verdict
    const message = 'standard/deep DeepResearch 未配置可用的 LLM Judge，启发式检查不能替代语义质量评估。'
    return {
      ...verdict,
      pass: false,
      failureKind: 'judge_unavailable',
      scores: { ...verdict.scores, overall: Math.min(verdict.scores.overall, 0.4) },
      blockingIssues: [...verdict.blockingIssues, message],
      issues: [
        ...(verdict.issues ?? []),
        { code: 'judge_unavailable', category: 'writing', message, severity: 'blocking' }
      ],
      recommendedFixes: ['配置并成功运行 LLM Judge 后再发布 standard/deep 报告。']
    }
  }
}

export class ModelQualityJudge implements QualityJudge {
  private readonly fallback: QualityJudge

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: QualityJudge
    }
  ) {
    this.fallback = options.fallback ?? new HeuristicQualityJudge()
  }

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    let lastError: unknown
    try {
      return await this.judgeAttempt(input)
    } catch (error) {
      throwIfResearchAborted(input.execution?.signal)
      lastError = error
    }

    const fallback = await this.fallback.judge(input)
    const unavailableMessage = `LLM Judge 未返回可用结果：${errorMessage(lastError)}`
    if (input.budget.preset !== 'quick') {
      return {
        ...fallback,
        source: 'heuristic_fallback',
        failureKind: 'judge_unavailable',
        pass: false,
        scores: {
          ...fallback.scores,
          overall: Math.min(fallback.scores.overall, 0.4)
        },
        blockingIssues: [unavailableMessage],
        issues: [{
          code: 'judge_unavailable',
          category: 'writing',
          message: unavailableMessage,
          severity: 'blocking'
        }],
        warnings: [
          ...fallback.warnings,
          'Judge 服务故障不会触发整篇报告重写，也不会覆盖已经通过的本地确定性校验。'
        ],
        recommendedFixes: ['仅重试 Judge；不要重新搜索或重写已经通过本地校验的报告。']
      }
    }
    return {
      ...fallback,
      source: 'heuristic_fallback',
      failureKind: 'judge_unavailable',
      warnings: [...fallback.warnings, unavailableMessage]
    }
  }

  private async judgeAttempt(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    const attempt = 1
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_QUALITY_JUDGE_TIMEOUT_MS)
    )
    const turnId = `research_judge_${hashJudgeInput(input)}_${attempt}`
    const prompt = buildQualityJudgePrompt(input, {
      compact: input.budget.preset === 'standard'
    })
    const maxTokens = 1_800
    const reservation = input.execution?.reserveModelCall(
      'judge',
      estimateResearchRequestTokens(`${MODEL_QUALITY_JUDGE_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_quality_judge',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_QUALITY_JUDGE_SYSTEM_PROMPT,
        prefix: [],
        history: [makeUserItem({
          id: `item_${turnId}_user`,
          threadId: 'research_quality_judge',
          turnId,
          text: prompt
        })],
        tools: [],
        stream: false,
        maxTokens,
        temperature: 0,
        responseFormat: 'json_object',
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'judge'),
        abortSignal: controller.signal
      }
      const collected = await collectJudgeText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const parsedVerdict = parseQualityJudgeVerdict(collected.text, {
        source: 'llm_judge',
        model,
        preset: input.budget.preset,
        judgedAt: input.nowIso
      })
      const citationFiltered = filterUnauditableJudgeCitationIssues(parsedVerdict, input)
      const verdict = reconcileJudgeVerdictWithArgumentAudit(citationFiltered, input)
      const usageRecords = collected.usage.slice(-1).map((usage) => ({
        stage: 'judge' as const,
        model,
        turnId,
        attempt,
        usage
      }))
      if (input.execution && reservation && usageRecords[0]) {
        await input.execution.recordModelUsage(usageRecords[0], reservation)
        usageRecorded = true
      }
      return {
        ...verdict,
        ...(verdict.pass ? {} : { failureKind: 'report_quality' as const }),
        ...(!input.execution && usageRecords.length > 0 ? { modelUsage: usageRecords } : {})
      }
    } finally {
      clearTimeout(timeout)
      unlinkAbort()
      if (input.execution && reservation) {
        const lastUsage = observedUsage.at(-1)
        if (!usageRecorded && lastUsage) {
          await input.execution.recordModelUsage({
            stage: 'judge',
            model,
            turnId,
            attempt,
            usage: lastUsage
          }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}

export function mergeQualityVerdictWithJudge(
  verdict: QualityVerdict,
  judge: QualityJudgeVerdict
): QualityVerdict {
  const rawJudgeIssues = judgeIssuesForMerge(judge)
  const confirmedThinSectionTitles = deterministicArgumentAdvisoryTitles(verdict)
  const belowPublicationFloor = judge.failureKind !== 'judge_unavailable' && (
    judge.scores.requirementsAlignment < 0.4
    || judge.scores.answersConfirmedScope < 0.4
    || judge.scores.overall < 0.4
  )
  const hardJudgeIssues = rawJudgeIssues.filter((issue) => (
    isPublicationBlockingJudgeIssue(issue)
    || isJudgeIssueConfirmedByArgumentAdvisory(issue, confirmedThinSectionTitles)
    || (belowPublicationFloor && issue.severity === 'blocking')
  ))
  const advisoryJudgeIssues = rawJudgeIssues.filter((issue) => !hardJudgeIssues.includes(issue))
  const judgeIssues = rawJudgeIssues.map((issue) => ({
    code: `llm_judge_${issue.category}_${issue.code}`,
    message: issue.message,
    severity: hardJudgeIssues.includes(issue) ? 'blocking' as const : 'warning' as const
  }))
  const judgeBlockingIssues = hardJudgeIssues.map((issue) => issue.message)
  const blockingIssues = [...verdict.blockingIssues, ...judgeBlockingIssues]
  return {
    ...verdict,
    pass: verdict.pass && judgeBlockingIssues.length === 0,
    scores: {
      ...verdict.scores,
      requirementsAlignment: judge.scores.requirementsAlignment,
      answersCoreQuestions: Math.min(verdict.scores.answersCoreQuestions, judge.scores.answersConfirmedScope),
      followsCoreResearchThread: Math.min(verdict.scores.followsCoreResearchThread, judge.scores.followsResearchFrame),
      reportCompleteness: judge.scores.reportCompleteness,
      citationAccuracy: Math.min(verdict.scores.citationAccuracy, judge.scores.citationFaithfulness),
      evidenceCoverage: Math.min(verdict.scores.evidenceCoverage, judge.scores.evidenceUse),
      uncertaintyCalibration: Math.min(verdict.scores.uncertaintyCalibration, judge.scores.uncertaintyCalibration),
      writingQuality: judge.scores.writingQuality,
      llmJudgeOverall: judge.scores.overall
    },
    llmJudge: judge,
    blockingIssues,
    warnings: [
      ...verdict.warnings,
      ...judge.warnings,
      ...advisoryJudgeIssues.map((issue) => `Judge 建议：${issue.message}`)
    ],
    recommendedFixes: [...verdict.recommendedFixes, ...judge.recommendedFixes],
    issues: [...verdict.issues, ...judgeIssues]
  }
}

function isPublicationBlockingJudgeIssue(issue: QualityJudgeIssue): boolean {
  if (issue.severity !== 'blocking' || issue.code.endsWith('_score_below_threshold')) return false
  if (issue.category === 'citation') {
    return Boolean(issue.occurrenceId && issue.claimId && issue.unsupportedFragment && issue.evidenceQuote)
  }
  if (issue.category !== 'writing') return false
  return /(?:repeat|duplicate|repetition|garbl|mojibake|raw.?url|markdown|malformed|broken|fragment|truncat|boilerplate|乱码|裸\s*url|裸链接|重复|残句|粘连|截断|结构破损|内部标记)/iu
    .test(`${issue.code} ${issue.message}`)
}

function deterministicArgumentAdvisoryTitles(verdict: QualityVerdict): Set<string> {
  return new Set(verdict.issues
    .filter((issue) => issue.code === 'report_argument_depth_advisory')
    .flatMap((issue) => [...issue.message.matchAll(/「([^」]{2,80})」/gu)].map((match) => match[1] ?? ''))
    .filter(Boolean))
}

function isJudgeIssueConfirmedByArgumentAdvisory(
  issue: QualityJudgeIssue,
  sectionTitles: ReadonlySet<string>
): boolean {
  if (issue.severity !== 'blocking' || sectionTitles.size === 0) return false
  if (issue.code.endsWith('_score_below_threshold')) return true
  const allegation = `${issue.code}\n${issue.message}`
  const allegesThinArgument = /(?:fact[_\s-]?summary|incomplete[_\s-]?synthesis|no[_\s-]?substance|weak[_\s-]?synthesis|事实摘要|仅(?:有|是|为|停留在)?(?:事实|材料)(?:罗列|摘要)|缺(?:少|乏).{0,20}(?:综合|推理|分析)|未.{0,20}(?:综合|推理|分析)|没有解释证据如何推出)/iu.test(allegation)
  return allegesThinArgument && [...sectionTitles].some((title) => allegation.includes(title))
}

function judgeIssuesForMerge(judge: QualityJudgeVerdict): QualityJudgeIssue[] {
  if (judge.issues && judge.issues.length > 0) return judge.issues
  return judge.blockingIssues.map((message, index) => ({
    code: `legacy_issue_${index + 1}`,
    category: inferJudgeIssueCategory(message),
    message,
    severity: 'blocking'
  }))
}

export function buildQualityJudgePrompt(
  input: QualityJudgeInput,
  options: { compact?: boolean; retryFeedback?: string } = {}
): string {
  return [
    '请评估这份 DeepResearch 最终报告是否满足已确认需求。',
    '',
    '已确认 Scope：',
    JSON.stringify({
      summary: input.scope.summary,
      mainContradiction: input.scope.mainContradiction,
      confirmationChecklist: input.scope.confirmationChecklist,
      clarifications: input.scope.readyForBrief ? [] : input.scope.clarificationQuestions
    }, null, 2),
    '',
    'ResearchBrief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      outputFormat: input.brief.outputFormat,
      successCriteria: input.brief.successCriteria,
      constraints: input.brief.constraints
    }, null, 2),
    '',
    'ResearchBudget：',
    JSON.stringify({
      preset: input.budget.preset,
      reasoningEffort: input.budget.reasoningEffort,
      minSources: input.budget.minSources,
      targetSources: input.budget.targetSources,
      maxSources: input.budget.maxSources
    }, null, 2),
    '',
    '本次发布分数线：',
    JSON.stringify(judgeThresholds(input.budget.preset)),
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
    'Research coverage outcome：',
    JSON.stringify((input.reportBlueprint?.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      questionIds: section.questionIds,
      evidenceMode: section.evidenceMode ?? 'direct',
      limitations: section.limitations
    })), null, 2),
    '',
    '确定性校验：',
    JSON.stringify({
      pass: input.deterministicVerdict.pass,
      scores: input.deterministicVerdict.scores,
      blockingIssues: input.deterministicVerdict.blockingIssues,
      warnings: input.deterministicVerdict.warnings
    }, null, 2),
    ...(input.previousVerdict?.pass === false ? [
      '',
      '上一轮未通过项（只作为复核清单；必须在当前报告重新定位，仍存在时继续阻塞，已删除或改写时不得重复）：',
      JSON.stringify({
        scores: input.previousVerdict.scores,
        blockingIssues: input.previousVerdict.blockingIssues.slice(0, 12),
        issues: (input.previousVerdict.llmJudge?.issues ?? []).slice(0, 8).map((issue) => ({
          code: issue.code,
          category: issue.category,
          message: issue.message,
          unsupportedFragment: issue.unsupportedFragment
        })),
        recommendedFixes: input.previousVerdict.recommendedFixes.slice(0, 8)
      }, null, 2)
    ] : []),
    '',
    '证据摘要：',
    JSON.stringify(buildJudgeEvidenceSummary(input, options.compact === true), null, 2),
    '',
    '章节结构审计：',
    JSON.stringify(reportSectionArgumentAudit(input.reportMarkdown), null, 2),
    '',
    '最终报告 Markdown（已压缩 HTML 引用属性，保留正文结构和 citation id）：',
    compactReportForJudge(input, options.compact === true),
    ...(options.retryFeedback ? [
      '',
      '上一轮 Judge 结果被运行时拒绝：',
      options.retryFeedback,
      '请重新逐 occurrence 核验，不要重复无法定位或与 evidenceSpans 矛盾的引用问题。'
    ] : []),
    '',
    '返回 JSON schema：',
    '{',
    '  "pass": boolean,',
    '  "scores": {',
    '    "requirementsAlignment": number,',
    '    "answersConfirmedScope": number,',
    '    "followsResearchFrame": number,',
    '    "reportCompleteness": number,',
    '    "evidenceUse": number,',
    '    "citationFaithfulness": number,',
    '    "uncertaintyCalibration": number,',
    '    "writingQuality": number,',
    '    "overall": number',
    '  },',
    '  "rationale": "一句话说明主要判断",',
  '  "issues": [{"code":"短错误码","category":"scope|evidence|citation|coverage|writing","message":"具体问题","severity":"blocking|warning","occurrenceId":"任何已引用句的证据问题必填","claimId":"任何已引用句的证据问题必填","unsupportedFragment":"报告中有问题的原文片段","evidenceQuote":"用于判定的证据原文；纯写作问题可省略"}],',
    '  "blockingIssues": ["兼容字段：阻塞性问题"],',
    '  "warnings": ["非阻塞问题"],',
    '  "recommendedFixes": ["建议修复"]',
    '}'
  ].join('\n')
}

export function parseQualityJudgeVerdict(
  raw: string,
  meta: {
    source: QualityJudgeVerdict['source']
    model?: string
    preset?: ResearchBudget['preset']
    judgedAt: string
  }
): QualityJudgeVerdict {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('Quality judge response did not contain JSON')
  const value = JSON.parse(json) as Record<string, unknown>
  const scores = isRecord(value.scores) ? value.scores : {}
  const normalizedScores = {
    requirementsAlignment: numberScore(scores.requirementsAlignment),
    answersConfirmedScope: numberScore(scores.answersConfirmedScope),
    followsResearchFrame: numberScore(scores.followsResearchFrame),
    reportCompleteness: numberScore(scores.reportCompleteness),
    evidenceUse: numberScore(scores.evidenceUse),
    citationFaithfulness: numberScore(scores.citationFaithfulness),
    uncertaintyCalibration: numberScore(scores.uncertaintyCalibration),
    writingQuality: numberScore(scores.writingQuality),
    overall: numberScore(scores.overall)
  }
  const scoreBlockingIssues = judgeScoreBlockingIssues(normalizedScores, meta.preset)
  const parsedIssues = normalizeJudgeIssues(value.issues)
  const structuredBlockingIssues = parsedIssues
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => issue.message)
  const parsedBlockingIssues = normalizeStringArray(value.blockingIssues, 8)
  const blockingIssues = [...new Set([...parsedBlockingIssues, ...structuredBlockingIssues, ...scoreBlockingIssues])]
  const declaredPass = booleanValue(value.pass)
  const pass = (declaredPass ?? scoreBlockingIssues.length === 0) && blockingIssues.length === 0
  if (!pass && blockingIssues.length === 0) {
    blockingIssues.push('LLM Judge 判定报告未通过，但未返回具体阻塞原因。')
  }
  const issues = mergeJudgeIssues(parsedIssues, blockingIssues, normalizedScores)
  return {
    source: meta.source,
    ...(meta.model ? { model: meta.model } : {}),
    pass,
    scores: normalizedScores,
    rationale: stringValue(value.rationale) || 'LLM Judge 已完成评分。',
    issues,
    blockingIssues: blockingIssues.slice(0, 12),
    warnings: normalizeStringArray(value.warnings, 8),
    recommendedFixes: normalizeStringArray(value.recommendedFixes, 8),
    judgedAt: meta.judgedAt
  }
}

function judgeScoreBlockingIssues(
  scores: QualityJudgeVerdict['scores'],
  preset: ResearchBudget['preset'] = 'standard'
): string[] {
  const issues: string[] = []
  const thresholds = judgeThresholds(preset)
  if (scores.overall < thresholds.overall) {
    issues.push(`LLM Judge 总分 ${formatScore(scores.overall)} 低于通过线 ${formatScore(thresholds.overall)}。`)
  }
  if (scores.requirementsAlignment < thresholds.core) {
    issues.push(`LLM Judge 需求匹配评分 ${formatScore(scores.requirementsAlignment)} 低于通过线 ${formatScore(thresholds.core)}。`)
  }
  if (scores.answersConfirmedScope < thresholds.core) {
    issues.push(`LLM Judge 核心问题回答评分 ${formatScore(scores.answersConfirmedScope)} 低于通过线 ${formatScore(thresholds.core)}。`)
  }
  if (scores.followsResearchFrame < thresholds.core) {
    issues.push(`LLM Judge ResearchFrame 遵循评分 ${formatScore(scores.followsResearchFrame)} 低于通过线 ${formatScore(thresholds.core)}。`)
  }
  if (scores.reportCompleteness < thresholds.completeness) {
    issues.push(`LLM Judge 报告完整度评分 ${formatScore(scores.reportCompleteness)} 低于通过线 ${formatScore(thresholds.completeness)}。`)
  }
  if (scores.evidenceUse < thresholds.evidence) {
    issues.push(`LLM Judge 证据使用评分 ${formatScore(scores.evidenceUse)} 低于通过线 ${formatScore(thresholds.evidence)}。`)
  }
  if (scores.citationFaithfulness < thresholds.citation) {
    issues.push(`LLM Judge 引用忠实度评分 ${formatScore(scores.citationFaithfulness)} 低于通过线 ${formatScore(thresholds.citation)}。`)
  }
  if (scores.writingQuality < thresholds.writing) {
    issues.push(`LLM Judge 写作与结论质量评分 ${formatScore(scores.writingQuality)} 低于通过线 ${formatScore(thresholds.writing)}。`)
  }
  return issues
}

function heuristicJudge(
  input: QualityJudgeInput,
  judgedAt: string,
  source: QualityJudgeVerdict['source']
): QualityJudgeVerdict {
  const report = input.reportMarkdown
  const includesCoreThread = isResearchTextRelevant(input.frame.coreResearchThread, report)
  const answeredQuestions = input.frame.coreQuestions.filter((question) => report.includes(question.text)).length
  const questionRatio = input.frame.coreQuestions.length === 0 ? 1 : answeredQuestions / input.frame.coreQuestions.length
  const citationRatio = input.citations.length > 0 ? 1 : 0
  const completeness = ['## 摘要', '## 调研范围与方法', '## 主要发现', '## 结论', '## 局限与不确定性']
    .filter((section) => report.includes(section)).length / 5
  const requirementsAlignment = includesCoreThread ? 0.8 : 0.45
  const overall = average([
    requirementsAlignment,
    questionRatio,
    includesCoreThread ? 0.85 : 0.45,
    completeness,
    citationRatio,
    citationRatio,
    report.includes('局限') ? 0.85 : 0.5,
    report.trim().length > 400 ? 0.75 : 0.45
  ])
  const blockingIssues = overall >= 0.65 ? [] : ['启发式评分认为报告未充分满足已确认需求。']
  return {
    source,
    pass: blockingIssues.length === 0,
    scores: {
      requirementsAlignment,
      answersConfirmedScope: questionRatio,
      followsResearchFrame: includesCoreThread ? 0.85 : 0.45,
      reportCompleteness: completeness,
      evidenceUse: citationRatio,
      citationFaithfulness: citationRatio,
      uncertaintyCalibration: report.includes('局限') ? 0.85 : 0.5,
      writingQuality: report.trim().length > 400 ? 0.75 : 0.45,
      overall
    },
    rationale: '启发式评分基于报告结构、核心主线、核心问题覆盖和引用存在性计算。',
    issues: blockingIssues.map((message) => ({
      code: 'heuristic_quality_below_threshold',
      category: 'writing' as const,
      message,
      severity: 'blocking' as const
    })),
    blockingIssues,
    warnings: ['当前评分未使用 LLM Judge，仅作为兜底。'],
    recommendedFixes: blockingIssues.length > 0 ? ['补齐核心问题、证据引用和完整报告结构后重新生成。'] : [],
    judgedAt
  }
}

async function collectJudgeText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal,
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
): Promise<{ text: string; usage: ResearchModelUsageRecord['usage'][] }> {
  let text = ''
  let reasoning = ''
  const usage: ResearchModelUsageRecord['usage'][] = []
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('quality judge timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'assistant_reasoning_delta') reasoning += chunk.text
    if (chunk.kind === 'usage') {
      usage.push(chunk.usage)
      onUsage?.(chunk.usage)
    }
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  const output = text.trim() || reasoning.trim()
  if (!output) throw new Error('quality judge returned empty text')
  return { text: output, usage }
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

function buildJudgeEvidenceSummary(input: QualityJudgeInput, compact = false): Record<string, unknown> {
  const uniqueSources = uniqueEligibleEvidenceSources(input.sources, input.evidenceSpans)
  const citedSpanIds = new Set(input.citations.flatMap((citation) => citation.evidenceSpanIds))
  const citedClaimIds = new Set(input.citations.flatMap((citation) =>
    citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])
  ))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const citedSpans = [...citedSpanIds]
    .map((spanId) => spanById.get(spanId))
    .filter((span): span is EvidenceSpan => Boolean(span))
    .slice(0, compact ? 12 : 24)
  const citedSourceIds = new Set(citedSpans.map((span) => span.sourceId))
  const citedSources = [...citedSourceIds]
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is SourceRecord => Boolean(source))
    .slice(0, compact ? 8 : 16)
  const citedClaims = [...citedClaimIds]
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is AtomicClaim => Boolean(claim))
    .slice(0, compact ? 12 : 24)
  const citedNotes = input.notes
    .filter((note) => note.claimIds.some((claimId) => citedClaimIds.has(claimId)))
    .slice(0, compact ? 6 : 12)
  const evidenceChainCitations = selectJudgeEvidenceChainCitations(input.citations, compact ? 24 : 32)
  return {
    counts: {
      sourceCount: uniqueSources.length,
      noteCount: input.notes.length,
      claimCount: input.claims.length,
      evidenceSpanCount: input.evidenceSpans.length,
      citationCount: input.citations.length,
      citedSourceCount: citedSources.length,
      citedClaimCount: citedClaims.length,
      citedEvidenceSpanCount: citedSpans.length
    },
    sourceQuality: {
      byReliability: countBy(uniqueSources.map((source) => source.reliability)),
      byType: countBy(uniqueSources.map((source) => source.sourceType)),
      lowOrUnknownSourceIds: uniqueSources
        .filter((source) => source.reliability === 'low' || source.reliability === 'unknown')
        .map((source) => source.id)
        .slice(0, 12)
    },
    citations: input.citations.slice(0, compact ? 0 : 32).map((citation) => ({
      id: citation.id,
      displayId: citation.displayId,
      displayIds: citation.displayIds,
      status: citation.status,
      claimId: citation.claimId,
      claimIds: citation.claimIds,
      evidenceSpanIds: citation.evidenceSpanIds.slice(0, 4),
      reportClaimText: fitText(cleanJudgeText(citation.reportClaimText), 180)
    })),
    citationEvidenceChains: evidenceChainCitations.map((citation) => {
      const claimIds = citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])
      const claims = claimIds
        .map((claimId) => claimById.get(claimId))
        .filter((claim): claim is AtomicClaim => Boolean(claim))
      const spans = citation.evidenceSpanIds
        .map((spanId) => spanById.get(spanId))
        .filter((span): span is EvidenceSpan => Boolean(span))
        .slice(0, 4)
      return {
        occurrenceId: citation.id,
        citationId: citation.id,
        displayId: citation.displayId,
        displayIds: citation.displayIds,
        reportClaimText: fitText(cleanJudgeText(citation.reportClaimText), compact ? 180 : 360),
        claimIds,
        claims: claims.map((claim) => fitText(cleanJudgeText(claim.text), compact ? 180 : 360)),
        evidenceSpans: spans.map((span) => ({
          id: span.id,
          sourceId: span.sourceId,
          text: fitText(cleanJudgeText(span.text), compact ? 240 : 560)
        }))
      }
    }),
    citedSources: citedSources.map((source) => ({
      id: source.id,
      sourceType: source.sourceType,
      title: fitText(cleanJudgeText(source.title), 160),
      publisher: source.publisher,
      url: source.canonicalUrl ?? source.originalUrl,
      reliability: source.reliability,
      sourcePolicyTags: source.sourcePolicyTags.slice(0, 8)
    })),
    citedClaims: (compact ? [] : citedClaims).map((claim) => ({
      id: claim.id,
      text: fitText(cleanJudgeText(claim.text), 220),
      confidence: claim.confidence,
      critical: claim.critical,
      supportSpanIds: claim.supportSpanIds.slice(0, 4)
    })),
    citedEvidenceSpans: (compact ? [] : citedSpans).map((span) => ({
      id: span.id,
      sourceId: span.sourceId,
      text: fitText(cleanJudgeText(span.text), 240)
    })),
    citedNotes: (compact ? [] : citedNotes).map((note) => ({
      questionIds: note.questionIds,
      claimIds: note.claimIds.filter((claimId) => citedClaimIds.has(claimId)).slice(0, 4),
      summary: fitText(cleanJudgeText(note.summary), 180),
      implicationForBrief: fitText(cleanJudgeText(note.implicationForBrief), 220),
      limitations: note.limitations.map(cleanJudgeText).filter(Boolean).slice(0, 4)
    }))
  }
}

function selectJudgeEvidenceChainCitations(
  citations: CitationBinding[],
  limit: number
): CitationBinding[] {
  const firstByDisplay: CitationBinding[] = []
  const remaining: CitationBinding[] = []
  const seenDisplays = new Set<string>()
  for (const citation of citations) {
    const displayKey = citation.displayId
      ?? citation.displayIds?.[0]
      ?? citation.id
    if (!seenDisplays.has(displayKey)) {
      seenDisplays.add(displayKey)
      firstByDisplay.push(citation)
    } else {
      remaining.push(citation)
    }
  }
  return [...firstByDisplay, ...remaining].slice(0, limit)
}

function compactReportForJudge(input: QualityJudgeInput, compact = false): string {
  const normalized = normalizeReportMarkdownForJudge(input.reportMarkdown)
  const limit = compact ? Math.min(9_000, reportJudgeCharLimit(input.budget)) : reportJudgeCharLimit(input.budget)
  if (normalized.length <= limit) return normalized
  const title = normalized.match(/^#\s+.+$/m)?.[0] ?? ''
  const sections = [
    title,
    compactSection(normalized, '摘要', 700),
    compactSection(normalized, '调研范围与方法', 500),
    compactFindingsSection(normalized, Math.floor(limit * 0.64)),
    compactSection(normalized, '结论与建议', Math.floor(limit * 0.22))
      || compactSection(normalized, '结论', Math.floor(limit * 0.22)),
    compactSection(normalized, '局限与不确定性', Math.floor(limit * 0.16)),
    compactSection(normalized, '后续研究建议', Math.floor(limit * 0.07))
  ].filter(Boolean)
  const compacted = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return compacted.length <= limit ? compacted : fitText(compacted, limit)
}

function compactFindingsSection(markdown: string, maxChars: number): string {
  const body = sectionBody(markdown, '主要发现')
  if (!body) return ''
  const sections = thirdLevelSections(body)
  if (sections.length === 0) return `## 主要发现\n\n${fitText(body, maxChars)}`
  const headingsChars = sections.reduce((sum, section) => sum + section.title.length + 8, 0)
  const perSectionChars = Math.max(500, Math.floor((maxChars - headingsChars) / sections.length))
  return [
    '## 主要发现',
    '',
    ...sections.flatMap((section) => [
      `### ${section.title}`,
      '',
      fitText(section.body, perSectionChars),
      ''
    ])
  ].join('\n').trim()
}

export function reportSectionArgumentAudit(markdown: string): Array<{
  title: string
  proseChars: number
  paragraphCount: number
  sentenceCount: number
  citationCount: number
  hasEvidenceSynthesis: boolean
  hasBoundary: boolean
}> {
  const findings = sectionBody(normalizeReportMarkdownForJudge(markdown), '主要发现')
  return thirdLevelSections(findings).map((section) => {
    const signals = reportArgumentSignals(section.body)
    return {
      title: section.title,
      proseChars: signals.chars,
      paragraphCount: signals.paragraphs,
      sentenceCount: signals.sentences,
      citationCount: [...section.body.matchAll(/\[cit_\d+\]/gu)].length,
      hasEvidenceSynthesis: signals.hasSynthesis,
      hasBoundary: signals.hasEvidenceBoundary
    }
  })
}

function thirdLevelSections(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split('\n')
  const sections: Array<{ title: string; lines: string[] }> = []
  let current: { title: string; lines: string[] } | undefined
  for (const line of lines) {
    const heading = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.trim()
    if (heading) {
      current = { title: heading, lines: [] }
      sections.push(current)
      continue
    }
    current?.lines.push(line)
  }
  return sections.map((section) => ({ title: section.title, body: section.lines.join('\n').trim() }))
}

function normalizeReportMarkdownForJudge(markdown: string): string {
  return markdown
    .replace(/<sup\s+data-citation-id="([^"]+)"[^>]*>\s*<a[^>]*>\[[^\]]+\]<\/a>\s*<\/sup>/g, '[$1]')
    .replace(/<sup\s+data-citation-id="([^"]+)"[^>]*>\[[^\]]+\]<\/sup>/g, '[$1]')
    .replace(/\[(\d+)\](?!:)/g, '[cit_$1]')
    .replace(/^\[\d+\]:\s+.*$/gmu, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function compactSection(markdown: string, title: string, maxChars: number): string {
  const body = sectionBody(markdown, title)
  if (!body) return ''
  return `## ${title}\n\n${fitText(body, maxChars)}`
}

function sectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false
  for (const line of lines) {
    const heading = line.trim().match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    if (heading && (heading === title || heading.startsWith(`${title}：`) || heading.startsWith(`${title}:`))) {
      collecting = true
      continue
    }
    if (collecting && /^##\s+/.test(line.trim())) break
    if (collecting) collected.push(line)
  }
  return collected.join('\n').trim()
}

function reportJudgeCharLimit(budget: ResearchBudget): number {
  if (budget.preset === 'deep') return 12_000
  if (budget.preset === 'standard') return 9_000
  return 6_000
}

function cleanJudgeText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-->+/g, ' ')
    .replace(/(?:Skip to main content|Toggle navigation|Main navigation)\s*/gi, ' ')
    .replace(/(?:浏览器不被支持|下载APP|下载客户端|登录|注册|媒体矩阵|爆料专线)\s*/g, ' ')
    .trim()
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeJudgeIssues(value: unknown): QualityJudgeIssue[] {
  if (!Array.isArray(value)) return []
  const categories = new Set<QualityJudgeIssue['category']>(['scope', 'evidence', 'citation', 'coverage', 'writing'])
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const message = stringValue(item.message)
    if (!message) return []
    const categoryValue = stringValue(item.category) as QualityJudgeIssue['category']
    const severityValue = stringValue(item.severity)
    const occurrenceId = stringValue(item.occurrenceId)
    const claimId = stringValue(item.claimId)
    const unsupportedFragment = stringValue(item.unsupportedFragment)
    const evidenceQuote = stringValue(item.evidenceQuote)
    return [{
      code: stringValue(item.code).replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || `issue_${index + 1}`,
      category: categories.has(categoryValue) ? categoryValue : inferJudgeIssueCategory(message),
      message,
      severity: severityValue === 'warning' ? 'warning' as const : 'blocking' as const,
      ...(occurrenceId ? { occurrenceId } : {}),
      ...(claimId ? { claimId } : {}),
      ...(unsupportedFragment ? { unsupportedFragment } : {}),
      ...(evidenceQuote ? { evidenceQuote } : {})
    }]
  }).slice(0, 12)
}

function filterUnauditableJudgeCitationIssues(
  verdict: QualityJudgeVerdict,
  input: QualityJudgeInput
): QualityJudgeVerdict {
  const citationByOccurrence = new Map(input.citations.map((citation) => [citation.id, citation]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const rejected = new Map<QualityJudgeIssue, string>()
  for (const issue of verdict.issues ?? []) {
    if (issue.severity !== 'blocking') continue
    if (isContradictedUnpunctuatedIssue(issue, input.reportMarkdown)) {
      rejected.set(issue, 'unsupportedFragment already contains explicit sentence or paragraph boundaries')
      continue
    }
    const citedSentenceAllegation = Boolean(issue.unsupportedFragment) && input.citations.some((citation) =>
      normalizedContains(citation.reportClaimText, issue.unsupportedFragment!) ||
      normalizedContains(issue.unsupportedFragment!, citation.reportClaimText)
    )
    const allegesUnsupportedEvidence = /(?:无依据|证据.{0,12}(?:未|不)(?:支持|包含)|原文.{0,12}(?:未|没有)|不被.{0,12}支持|技术扩写|过度推断|引用不忠实)/u.test(issue.message)
    const auditsCitedEvidence = issue.category === 'citation' ||
      Boolean(issue.occurrenceId || issue.claimId || issue.evidenceQuote) ||
      (citedSentenceAllegation && allegesUnsupportedEvidence)
    if (!auditsCitedEvidence) continue
    if (issue.code === 'citation_score_below_threshold' && verdict.scores.citationFaithfulness < MIN_JUDGE_CITATION_PASS) continue
    let reason: string | undefined
    if (!issue.occurrenceId || !issue.claimId || !issue.unsupportedFragment || !issue.evidenceQuote) {
      reason = 'missing occurrenceId, claimId, unsupportedFragment or evidenceQuote'
    } else {
      const citation = citationByOccurrence.get(issue.occurrenceId)
      if (!citation) {
        reason = `references unknown occurrence ${issue.occurrenceId}`
      } else if (!(citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])).includes(issue.claimId)) {
        reason = `mismatches occurrence claims ${(citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])).join(',') || 'none'}`
      } else {
        const evidenceText = citation.evidenceSpanIds
          .map((spanId) => spanById.get(spanId)?.text ?? '')
          .join('\n')
        if (!normalizedContains(evidenceText, issue.evidenceQuote)) {
          reason = `quotes text outside occurrence ${issue.occurrenceId}`
        } else if (normalizedContains(evidenceText, issue.unsupportedFragment)) {
          reason = `contradicts occurrence evidence ${issue.occurrenceId}`
        }
      }
    }
    if (reason) rejected.set(issue, reason)
  }
  if (rejected.size === 0) return verdict

  const rejectedMessages = new Set([...rejected.keys()].map((issue) => issue.message))
  const issues = (verdict.issues ?? []).filter((issue) => !rejected.has(issue))
  const blockingIssues = verdict.blockingIssues.filter((message) => !rejectedMessages.has(message))
  return {
    ...verdict,
    pass: blockingIssues.length === 0,
    issues,
    blockingIssues,
    warnings: [
      ...verdict.warnings,
      ...[...rejected.entries()].map(([issue, reason]) =>
        `已忽略无法审计的 Judge 引用问题 ${issue.code}：${reason}。`
      )
    ]
  }
}

export function reconcileJudgeVerdictWithArgumentAudit(
  verdict: QualityJudgeVerdict,
  input: QualityJudgeInput
): QualityJudgeVerdict {
  if (!input.deterministicVerdict.pass) return verdict
  const audit = reportSectionArgumentAudit(input.reportMarkdown)
  const confirmedThinSectionTitles = deterministicArgumentAdvisoryTitles(input.deterministicVerdict)
  const evidenceGapTitles = new Set((input.reportBlueprint?.sections ?? [])
    .filter((section) => section.evidenceMode === 'evidence_gap')
    .map((section) => section.title))
  const auditConfirmsStructure = audit.length > 0 && audit.every((section) =>
    evidenceGapTitles.has(section.title)
      ? section.paragraphCount >= 1 && section.hasBoundary
      : section.paragraphCount >= 1 && section.citationCount >= 1 && section.hasEvidenceSynthesis && section.hasBoundary
  )

  const rejected = new Map<QualityJudgeIssue, string>()
  for (const issue of verdict.issues ?? []) {
    if (issue.severity !== 'blocking' || issue.code.endsWith('_score_below_threshold')) continue
    if (isUnconfirmedRequirementExpansionIssue(issue, input)) {
      rejected.set(issue, 'the Judge attributed named subtopics to the user, but they are absent from the user topic, user clarifications, and confirmed core questions')
      continue
    }
    if (isAnsweredEvidenceGapIssue(issue, input)) {
      rejected.set(issue, 'the section explicitly gives a bounded non-answer after evidence repair produced no new answering facts')
      continue
    }
    if (isStaleSummaryConclusionRepetitionIssue(issue, input.reportMarkdown)) {
      rejected.set(issue, 'the quoted summary or conclusion fragment is no longer present in the current report')
      continue
    }
    const targetsConfirmedThinSection = [...confirmedThinSectionTitles]
      .some((title) => `${issue.message}\n${issue.unsupportedFragment ?? ''}`.includes(title))
    const closingRepeatNeedsRepair = confirmedThinSectionTitles.size > 0
      && /(?:结论|conclusion).{0,32}(?:重复|repeat|duplicat).{0,32}(?:无|没有|缺少|缺乏|no).{0,16}(?:分析|综合|价值|analysis|synthesis|value)/iu.test(
        `${issue.code}\n${issue.message}`
      )
    if (!closingRepeatNeedsRepair && isUnsubstantiatedBroadRepetitionIssue(issue, input.reportMarkdown)) {
      rejected.set(issue, 'the cited fragment occurs in at most one findings section; summary and conclusion recaps are not blocking repetition')
      continue
    }
    if (isValidConditionalSceneAnalysisIssue(issue, input.reportMarkdown)) {
      rejected.set(issue, 'the quoted report sentence is a concrete if-then application with an explicit no-direct-evidence boundary')
      continue
    }
    if (isStaleQuotedFragmentIssue(issue, input.reportMarkdown)) {
      rejected.set(issue, 'the quoted fragment is absent from the current report')
      continue
    }
    if (!auditConfirmsStructure) continue
    const allegation = `${issue.message}\n${issue.unsupportedFragment ?? ''}`
    const broadTarget = /(?:所有|全部|每个|各个?|整个报告|全部核心|所有主要发现|all\s+(?:core\s+)?sections?)/iu.test(allegation)
    const deniesAuditedStructure = /(?:无|没有|缺少|缺乏|均无|全为\s*false|仅(?:罗列|包含)).{0,28}(?:综合|推理|局部结论|适用边界|证据边界)|hasEvidenceSynthesis.{0,12}false/iu.test(allegation)
    if (broadTarget && deniesAuditedStructure) {
      rejected.set(issue, 'deterministic section audit confirms citations, synthesis, and evidence boundaries in every findings section')
      continue
    }
    if (isDisclosedSelfReportedEvidenceIssue(issue, input.reportMarkdown, input.budget.preset)) {
      rejected.set(issue, 'the current section explicitly identifies the evidence as company strategy or self-claimed results; missing third-party corroboration is not citation unfaithfulness')
      continue
    }
    if (!targetsConfirmedThinSection && isContradictedConcreteSectionStructureIssue(issue, audit, input.reportMarkdown, input.budget.preset)) {
      rejected.set(issue, 'the quoted current sentence itself satisfies the audited synthesis or evidence-boundary contract')
      continue
    }
    if (!targetsConfirmedThinSection && isUnsubstantiatedSectionAnalysisIssue(issue, audit)) {
      rejected.set(issue, 'the Judge did not quote a concrete section fragment while deterministic audit confirms a cited synthesis and evidence boundary')
    }
  }
  for (const issue of verdict.issues ?? []) {
    if (rejected.has(issue) || !isCompatibilityBlockingSummaryIssue(issue)) continue
    const relatedRejectedIssue = [...rejected.keys()].find((candidate) =>
      candidate.category === issue.category && judgeIssuesShareTarget(candidate, issue, audit)
    )
    if (relatedRejectedIssue) {
      rejected.set(issue, `compatibility blocking summary duplicates rejected issue ${relatedRejectedIssue.code}`)
    }
  }
  if (rejected.size === 0) return verdict

  const rejectedMessages = new Set([...rejected.keys()].map((issue) => issue.message))
  const retainedIssues = (verdict.issues ?? []).filter((issue) => !rejected.has(issue))
  const thresholds = judgeThresholds(input.budget.preset)
  const retainedScoreBlockingIssues = judgeScoreBlockingIssues(verdict.scores, input.budget.preset)
  const retainedBlockingIssues = verdict.blockingIssues.filter((message) => !rejectedMessages.has(message))
  if ((input.budget.preset === 'deep' || confirmedThinSectionTitles.size > 0) && retainedScoreBlockingIssues.length > 0) {
    return {
      ...verdict,
      pass: false,
      issues: mergeJudgeIssues(retainedIssues, retainedScoreBlockingIssues, verdict.scores),
      blockingIssues: [...new Set([...retainedBlockingIssues, ...retainedScoreBlockingIssues])],
      warnings: [
        ...verdict.warnings,
        ...[...rejected.entries()].map(([issue, reason]) =>
          `已忽略与章节审计矛盾的 Judge 问题 ${issue.code}：${reason}。`
        )
      ]
    }
  }
  const actionableBlockingIssues = retainedIssues.filter((issue) =>
    issue.severity === 'blocking' && !issue.code.endsWith('_score_below_threshold')
  )
  if (actionableBlockingIssues.length > 0) {
    return {
      ...verdict,
      issues: retainedIssues,
      blockingIssues: verdict.blockingIssues.filter((message) => !rejectedMessages.has(message)),
      warnings: [
        ...verdict.warnings,
        ...[...rejected.entries()].map(([issue, reason]) =>
          `已忽略与章节审计矛盾的 Judge 问题 ${issue.code}：${reason}。`
        )
      ]
    }
  }

  const nonScoreIssues = retainedIssues.filter((issue) => !issue.code.endsWith('_score_below_threshold'))
  return {
    ...verdict,
    pass: true,
    scores: {
      ...verdict.scores,
      reportCompleteness: Math.max(verdict.scores.reportCompleteness, thresholds.completeness),
      evidenceUse: Math.max(verdict.scores.evidenceUse, thresholds.evidence),
      writingQuality: Math.max(verdict.scores.writingQuality, thresholds.writing),
      overall: Math.max(verdict.scores.overall, thresholds.overall)
    },
    issues: nonScoreIssues,
    blockingIssues: [],
    warnings: [
      ...verdict.warnings,
      ...[...rejected.entries()].map(([issue, reason]) =>
        `已忽略与章节审计矛盾的 Judge 问题 ${issue.code}：${reason}。`
      )
    ]
  }
}

function isAnsweredEvidenceGapIssue(issue: QualityJudgeIssue, input: QualityJudgeInput): boolean {
  if (issue.category !== 'scope' && issue.category !== 'coverage' && issue.category !== 'evidence') return false
  const allegation = `${issue.code}\n${issue.message}`
  if (!/(?:未提供|未覆盖|没有|缺乏|缺少|不足|missing|lacks?|insufficient).{0,100}(?:证据|数据|指标|来源|分析|回答|覆盖|evidence|data|source|analysis|answer|coverage)|(?:无实质内容|未回答|没有回答|未形成结论|no\s+substantive\s+(?:content|answer)|does\s+not\s+answer)/iu.test(allegation)) {
    return false
  }
  return (input.reportBlueprint?.sections ?? []).some((section) => {
    if (section.evidenceMode !== 'evidence_gap') return false
    const body = reportThirdLevelSectionBody(input.reportMarkdown, section.title)
    if (!hasExplicitEvidenceGapBoundary(body)) return false
    const issueTargetsSection = repairTitleVariants(section.title).some((variant) =>
      variant.length >= 4 && normalizeJudgeSectionText(allegation).includes(variant)
    )
    const fragment = issue.unsupportedFragment?.trim() ?? ''
    return issueTargetsSection || (fragment.length >= 6 && normalizedContains(body, fragment))
  })
}

function isStaleQuotedFragmentIssue(issue: QualityJudgeIssue, reportMarkdown: string): boolean {
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  return fragment.length >= 12 && !normalizedContains(reportMarkdown, fragment)
}

function reportThirdLevelSectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (start < 0) return ''
  const next = lines.slice(start + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join('\n').trim()
}

function repairTitleVariants(title: string): string[] {
  const withoutTime = title
    .replace(/(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]{1,5})\s*(?:年|个月|月|周|天|日|季度)/gu, '')
    .replace(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?(?:years?|months?|weeks?|days?|quarters?)\b/giu, '')
    .replace(/^(?:过去|未来|最近|近期|当前|主要|关键|核心|总体|综合)+/u, '')
  return [...new Set([title, withoutTime].map(normalizeJudgeSectionText).filter(Boolean))]
}

function normalizeJudgeSectionText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function isUnconfirmedRequirementExpansionIssue(
  issue: QualityJudgeIssue,
  input: QualityJudgeInput
): boolean {
  if (issue.category !== 'scope' && issue.category !== 'coverage') return false
  const message = issue.message.normalize('NFKC')
  if (!/(?:用户.{0,16}(?:明确要求|明确提出|确认要求|要求|关注)|explicitly\s+(?:requested|required)|confirmed\s+(?:requirement|scope))/iu.test(message)) {
    return false
  }
  const missingClause = message.match(
    /(?:未(?:覆盖|涉及|提及|回答|分析)|缺少|缺乏)([\s\S]{2,140}?)(?=(?:等)?用户.{0,16}(?:明确要求|明确提出|确认要求|要求|关注)|explicitly\s+(?:requested|required)|confirmed\s+(?:requirement|scope)|[。；;]|$)/iu
  )?.[1]?.trim()
  if (!missingClause) return false
  const requirementText = [
    input.brief.topic,
    ...(input.brief.userClarifications ?? []),
    ...input.frame.coreQuestions.map((question) => question.text)
  ].join('\n').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const namedFacets = missingClause
    .split(/[、，,；;]|\s+(?:and|or)\s+|以及/iu)
    .map((facet) => facet
      .replace(/^[「“"'\s]+|[」”"'\s]+$/gu, '')
      .replace(/^(?:关于|对于|对)/u, '')
      .replace(/(?:等等|等|相关|方面|内容|子项|维度)$/u, '')
      .trim())
    .filter((facet) => facet.replace(/[^\p{L}\p{N}]+/gu, '').length >= 2)
  if (namedFacets.length === 0) return false
  return namedFacets.some((facet) => {
    const normalized = facet.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return normalized.length >= 2 && !requirementText.includes(normalized)
  })
}

function isCompatibilityBlockingSummaryIssue(issue: QualityJudgeIssue): boolean {
  return issue.severity === 'blocking' &&
    issue.code.endsWith('_score_below_threshold') &&
    !/^LLM Judge .*(?:评分|总分).+低于通过线/u.test(issue.message)
}

function judgeIssuesShareTarget(
  left: QualityJudgeIssue,
  right: QualityJudgeIssue,
  audit: ReturnType<typeof reportSectionArgumentAudit>
): boolean {
  if (normalizedContains(left.message, right.message) || normalizedContains(right.message, left.message)) return true
  return audit.some((section) => left.message.includes(section.title) && right.message.includes(section.title))
}

function isStaleSummaryConclusionRepetitionIssue(issue: QualityJudgeIssue, reportMarkdown: string): boolean {
  const allegation = `${issue.code}\n${issue.message}`
  if (!/(?:重复|repetition)/iu.test(allegation) || !/(?:摘要|summary)/iu.test(allegation) || !/(?:结论|conclusion)/iu.test(allegation)) {
    return false
  }
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  const paired = fragment.match(/(?:摘要|summary)\s*[：:]\s*([\s\S]*?)(?:结论(?:与建议)?|conclusion)\s*[：:]\s*([\s\S]+)/iu)
  if (!paired) return false
  const summaryFragment = cleanLabeledJudgeFragment(paired[1] ?? '')
  const conclusionFragment = cleanLabeledJudgeFragment(paired[2] ?? '')
  if (summaryFragment.length < 8 || conclusionFragment.length < 8) return false
  const normalizedReport = normalizeReportMarkdownForJudge(reportMarkdown)
  const summary = sectionBody(normalizedReport, '摘要')
  const conclusion = sectionBody(normalizedReport, '结论') || sectionBody(normalizedReport, '结论与建议')
  return !normalizedContains(summary, summaryFragment) || !normalizedContains(conclusion, conclusionFragment)
}

function cleanLabeledJudgeFragment(value: string): string {
  return value.replace(/^[\s'“”"]+|[\s'“”"]+$/gu, '').trim()
}

function isContradictedConcreteSectionStructureIssue(
  issue: QualityJudgeIssue,
  audit: ReturnType<typeof reportSectionArgumentAudit>,
  reportMarkdown: string,
  preset: ResearchBudget['preset']
): boolean {
  if (preset !== 'standard') return false
  const allegation = `${issue.code}\n${issue.message}`
  const deniesSynthesis = /(?:incomplete[_\s-]?synthesis|no[_\s-]?synthesis|缺(?:少|乏).{0,20}(?:实质)?(?:综合|推理|分析)|未.{0,20}(?:综合|推理|分析)|仅(?:堆砌|罗列|重复))/iu.test(allegation)
  const deniesBoundary = /(?:no[_\s-]?boundary|missing[_\s-]?boundary|缺(?:少|乏).{0,16}(?:边界|适用条件)|未.{0,16}(?:边界|适用条件))/iu.test(allegation)
  if (!deniesSynthesis && !deniesBoundary) return false
  const targetSections = auditedSectionsForIssue(issue, audit, reportMarkdown)
  if (targetSections.length === 0) return false
  if (deniesBoundary && targetSections.every((section) => section.hasBoundary)) return true
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  if (fragment.length < 12) return false
  const fragmentSignals = reportArgumentSignals(fragment)
  if (
    deniesSynthesis
    && fragmentSignals.hasEvidenceBoundary
    && targetSections.every((section) => section.hasEvidenceSynthesis && section.hasBoundary)
  ) return true
  if (deniesSynthesis && fragmentSignals.hasSynthesis && targetSections.every((section) => section.hasEvidenceSynthesis && section.hasBoundary)) {
    return true
  }
  return false
}

function auditedSectionsForIssue(
  issue: QualityJudgeIssue,
  audit: ReturnType<typeof reportSectionArgumentAudit>,
  reportMarkdown: string
): ReturnType<typeof reportSectionArgumentAudit> {
  const allegation = `${issue.message}\n${issue.unsupportedFragment ?? ''}`
  const named = audit.filter((section) => allegation.includes(section.title))
  if (named.length > 0) return named
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  if (fragment.length < 12) return []
  const findings = sectionBody(normalizeReportMarkdownForJudge(reportMarkdown), '主要发现')
  const matchedTitles = new Set(thirdLevelSections(findings)
    .filter((section) => normalizedContains(section.body, fragment))
    .map((section) => section.title))
  return audit.filter((section) => matchedTitles.has(section.title))
}

function isUnsubstantiatedBroadRepetitionIssue(issue: QualityJudgeIssue, reportMarkdown: string): boolean {
  const allegation = `${issue.message}\n${issue.unsupportedFragment ?? ''}`
  if (!/(?:大量|多处|多个章节|全篇|整个报告|机械拼接|结论.{0,20}重复.{0,16}(?:摘要|主要发现|正文)|摘要.{0,20}(?:与|和|及).{0,12}(?:主要发现|正文).{0,20}重复|summary.{0,20}(?:findings|body).{0,20}(?:repeat|duplicat)).{0,20}(?:重复|拼接|摘要|主要发现|正文|repeat|duplicat)?/iu.test(allegation)) return false
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  if (fragment.length < 12) return true
  const findings = sectionBody(normalizeReportMarkdownForJudge(reportMarkdown), '主要发现')
  if (!findings) return false
  const matchingSections = thirdLevelSections(findings).filter((section) =>
    section.body.split('\n').flatMap((line) => splitCitationSentences(line))
      .some((sentence) => normalizedContains(sentence, fragment) || normalizedContains(fragment, sentence))
  )
  return matchingSections.length <= 1
}

function isValidConditionalSceneAnalysisIssue(issue: QualityJudgeIssue, reportMarkdown: string): boolean {
  const allegation = `${issue.code}\n${issue.message}`
  if (!/(?:场景|scene).{0,32}(?:仅|只|缺|未).{0,24}(?:分析|推理|综合)|scene[_\s-]?no[_\s-]?analysis/iu.test(allegation)) return false
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  if (fragment.length < 24) return false
  const conditionalSentence = splitCitationSentences(fragment)
    .find((sentence) => /(?:若|如果).{2,120}(?:则|必须|需要|会|可|能够)/u.test(sentence)
      && /(?:并非|不是|未直接|没有直接|不能声称|不能据此|现有证据)/u.test(sentence))
  if (!conditionalSentence) return false
  const reportSentence = conditionalSentence
    .replace(/^.*?[：:]\s*['“"]?(?=由此判断|因此|关键在于)/u, '')
    .replace(/['”"]\s*$/u, '')
    .trim()
  const normalizedReport = normalizeReportMarkdownForJudge(reportMarkdown)
  return normalizedContains(normalizedReport, reportSentence)
}

function isDisclosedSelfReportedEvidenceIssue(
  issue: QualityJudgeIssue,
  reportMarkdown: string,
  preset: ResearchBudget['preset']
): boolean {
  if (preset !== 'standard') return false
  const allegation = `${issue.code}\n${issue.message}`
  if (!/(?:自我陈述|自身陈述|自述|自称|宣称)|self[-\s]?reported/iu.test(allegation)) return false
  if (!/(?:第三方|独立来源|independent|third[-\s]?party)/iu.test(allegation)) return false
  const findings = sectionBody(normalizeReportMarkdownForJudge(reportMarkdown), '主要发现')
  const sections = thirdLevelSections(findings)
  const named = sections.filter((section) => issue.message.includes(section.title))
  const targets = named.length > 0 ? named : sections.filter((section) =>
    normalizedContains(section.body, issue.unsupportedFragment ?? '')
  )
  return targets.length > 0 && targets.every((section) =>
    /(?:现有|当前|本章)证据.{0,48}(?:自身|自我|发布方)?(?:意图|陈述|宣称|声称|结果)|(?:未|没有).{0,16}(?:第三方|独立来源).{0,16}(?:验证|印证|交叉验证)/u.test(section.body)
  )
}

function isUnsubstantiatedSectionAnalysisIssue(
  issue: QualityJudgeIssue,
  audit: ReturnType<typeof reportSectionArgumentAudit>
): boolean {
  const allegation = `${issue.code}\n${issue.message}`
  if (!/(?:只(?:是|在)?(?:重复|堆砌|罗列)|仅(?:重复|堆砌|罗列)|缺(?:少|乏).{0,16}(?:实质|综合|推理|分析)|未(?:进行|提供|形成).{0,16}(?:真正|实质|场景)?(?:分析|综合|推理)|no[_\s-]?substance|weak[_\s-]?synthesis)/iu.test(allegation)) {
    return false
  }
  if ((issue.unsupportedFragment?.trim().length ?? 0) >= 12) return false
  const namedSections = audit.filter((section) => issue.message.includes(section.title))
  const targets = namedSections.length > 0 ? namedSections : audit
  return targets.length > 0 && targets.every((section) =>
    section.citationCount >= 1 && section.hasEvidenceSynthesis && section.hasBoundary
  )
}

function isContradictedUnpunctuatedIssue(issue: QualityJudgeIssue, reportMarkdown: string): boolean {
  if (!/(?:无标点|句子粘连|粘连长句|缺少句末|没有句末)/u.test(`${issue.code}\n${issue.message}`)) return false
  const fragment = issue.unsupportedFragment?.trim() ?? ''
  if (!fragment) return false
  if (/[。！？!?；;]|\n\s*\n/u.test(fragment)) return true
  const normalizedReport = normalizeReportMarkdownForJudge(reportMarkdown)
  return normalizedReport
    .split('\n')
    .flatMap((line) => splitCitationSentences(line))
    .some((sentence) => {
      if (!normalizedContains(sentence, fragment) && !normalizedContains(fragment, sentence)) return false
      const prose = sentence.replace(/\[cit_\d+\]/gu, '').trim()
      return /[。！？!?；;]$/u.test(prose)
    })
}

function normalizedContains(haystack: string, needle: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const normalizedNeedle = normalize(needle)
  return normalizedNeedle.length >= 4 && normalize(haystack).includes(normalizedNeedle)
}

function mergeJudgeIssues(
  parsed: QualityJudgeIssue[],
  blockingIssues: string[],
  scores: QualityJudgeVerdict['scores']
): QualityJudgeIssue[] {
  const result = [...parsed]
  for (const message of blockingIssues) {
    if (result.some((issue) => issue.message === message)) continue
    result.push({
      code: scoreIssueCode(message, scores),
      category: inferJudgeIssueCategory(message),
      message,
      severity: 'blocking'
    })
  }
  return result.slice(0, 16)
}

function inferJudgeIssueCategory(message: string): QualityJudgeIssue['category'] {
  if (/范围|需求|ResearchFrame|核心问题|跑题|偏题/i.test(message)) return 'scope'
  if (/引用|citation|忠实|数字.*支撑|出处/i.test(message)) return 'citation'
  if (/来源|证据|交叉验证|可靠|可验证/i.test(message)) return 'evidence'
  if (/章节|维度|覆盖|完整|遗漏/i.test(message)) return 'coverage'
  return 'writing'
}

function scoreIssueCode(message: string, _scores: QualityJudgeVerdict['scores']): string {
  if (/引用|citation|忠实/i.test(message)) return 'citation_score_below_threshold'
  if (/证据|来源/i.test(message)) return 'evidence_score_below_threshold'
  if (/需求|核心问题|ResearchFrame|范围/i.test(message)) return 'scope_score_below_threshold'
  if (/完整|覆盖|章节|维度/i.test(message)) return 'coverage_score_below_threshold'
  return 'writing_score_below_threshold'
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

function numberScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function formatScore(value: number): string {
  return value.toFixed(2)
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hashJudgeInput(input: QualityJudgeInput): string {
  const previousFailure = input.previousVerdict?.pass === false
    ? input.previousVerdict.blockingIssues.join('|')
    : ''
  const text = `${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.reportMarkdown}\n${previousFailure}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
