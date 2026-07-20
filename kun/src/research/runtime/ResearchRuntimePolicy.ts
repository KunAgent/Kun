/**
 * [INPUT]: 依赖 ResearchRun、gap/convergence/quality verdict、worker 能力与 evidence ledger
 * [OUTPUT]: 对外提供 Runtime 的计划适配、按 Judge 点名章节及去除时间窗/范围修饰词后的短标题隔离缺口且把负面诊断改写为正向证据目标的无固定轮次补研任务生成、仅在完全没有真实证据时前置失败的基础证据判定，以及让结构化缺证类别优先于同时出现的重复/断句问题、区分真实缺证与综合缺失或无依据扩写的 Judge 失败分类纯策略
 * [POS]: research/runtime 的无状态策略模块，被 ResearchRuntime 编排核心调用；Gap 负责继续检索和死循环识别，章节是否可写统一交给 WritableGate
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { PlanAgent, ResearchSupervisor, ResearchTaskWorker } from '../agents/types.js'
import type {
  HypothesisTest,
  QualityVerdict,
  ResearchConvergenceVerdict,
  ResearchGapVerdict,
  ResearchPlan,
  ResearchRun,
  ResearchTask
} from '../core/types.js'
import { canCiteEvidenceSpan } from '../evidence/EvidenceEligibility.js'
import type { EvidenceSpan, SourceRecord } from '../evidence/types.js'

export class PlanAgentSupervisor implements ResearchSupervisor {
  constructor(private readonly planAgent: PlanAgent) {}

  createInitialPlan(input: Parameters<ResearchSupervisor['createInitialPlan']>[0]): Promise<ResearchPlan> {
    return this.planAgent.createPlan(input)
  }
}

export function normalizeGapVerdict(verdict: ResearchGapVerdict): ResearchGapVerdict {
  if (verdict.status !== 'need_more' || verdict.followUpTasks.length > 0) return verdict
  return {
    ...verdict,
    status: 'unanswerable',
    stopReason: `${verdict.stopReason} Evaluator 没有生成新的可执行检索任务，runtime 将进入证据门校验。`
  }
}

export function shouldRunDeepVoiFollowUp(
  run: ResearchRun,
  convergence: ResearchConvergenceVerdict,
  sourceCount: number,
  roundIndex: number
): boolean {
  return run.budget.preset !== 'quick' &&
    convergence.wouldFurtherResearchChangeConclusion &&
    convergence.unresolvedHighValueTestIds.length > 0 &&
    sourceCount < run.budget.maxSources
}

export function tasksFromHighValueTests(input: {
  tests: HypothesisTest[]
  convergence: ResearchConvergenceVerdict
  run: ResearchRun
  roundIndex: number
  remainingSources: number
}): ResearchTask[] {
  const unresolved = new Set(input.convergence.unresolvedHighValueTestIds)
  const alreadyRetried = new Set(input.run.plan?.tasks
    ?.filter((task) => task.id.startsWith('voi_'))
    .flatMap((task) => task.testIds ?? []) ?? [])
  const sourceFloor = taskSourceFloorForRun(input.run, input.remainingSources)
  const taskLimit = Math.max(1, Math.min(
    input.run.budget.maxSubagents,
    Math.floor(input.remainingSources / sourceFloor),
    3
  ))
  const selectedTests = input.tests
    .filter((test) => unresolved.has(test.id))
    .filter((test) => !alreadyRetried.has(test.id))
    .sort((left, right) => right.valueOfInformation.score - left.valueOfInformation.score)
    .slice(0, taskLimit)
  if (selectedTests.length === 0 || input.remainingSources <= 0) return []
  const perTask = Math.max(sourceFloor, Math.floor(input.remainingSources / selectedTests.length))
  return selectedTests.map((test, index) => ({
    id: `voi_${input.roundIndex + 1}_task_${index + 1}`,
    questionIds: test.questionIds,
    hypothesisIds: [test.hypothesisId],
    testIds: [test.id],
    objective: `寻找能改变最终判断的证据：${test.testQuestion}`,
    expectedEvidence: [
      `如果该搜索成功，必须能改变、削弱或限定最终判断；否则不继续补充相关资料。`,
      test.expectedEvidenceIfTrue,
      test.evidenceThatWouldWeakenIt
    ],
    sourceTypes: test.preferredSources,
    searchHints: [
      input.run.brief.topic,
      input.run.frame.centralQuestion,
      test.testQuestion,
      test.expectedEvidenceIfTrue,
      test.evidenceThatWouldWeakenIt
    ].map((hint) => hint.trim()).filter(Boolean),
    maxSources: Math.max(sourceFloor, Math.min(perTask, input.remainingSources - index * perTask || sourceFloor)),
    priority: test.priority,
    valueOfInformation: test.valueOfInformation,
    status: 'pending'
  }))
}

export function availableRepairSourceTypes(run: ResearchRun, worker: ResearchTaskWorker): ResearchTask['sourceTypes'] {
  const allowed = new Set(run.brief.sourcePolicy.allowedSourceTypes)
  const sourceTypes: ResearchTask['sourceTypes'] = []
  if (allowed.has('web') && (worker.hasSearchCapability?.() ?? false)) {
    sourceTypes.push('web')
  }
  if (worker.hasLocalEvidenceCapability?.() ?? false) {
    for (const sourceType of run.brief.sourcePolicy.allowedSourceTypes) {
      if (sourceType !== 'web') sourceTypes.push(sourceType)
    }
  }
  return [...new Set(sourceTypes)]
}

export function verificationEvidenceTasks(input: {
  run: ResearchRun
  verdict: QualityVerdict
  attempt: number
  roundIndex: number
  remainingSources: number
  sourceTypes: ResearchTask['sourceTypes']
}): ResearchTask[] {
  if (input.remainingSources <= 0 || input.sourceTypes.length === 0) return []
  const sourceFloor = taskSourceFloorForRun(input.run, input.remainingSources)
  const questionLimit = Math.max(1, Math.min(
    input.run.budget.maxSubagents,
    Math.floor(input.remainingSources / sourceFloor)
  ))
  const requiredQuestions = verificationRepairTargetQuestions(input.run, input.verdict)
    .slice(0, questionLimit)
  const questions = requiredQuestions.length > 0 ? requiredQuestions : input.run.frame.coreQuestions.slice(0, 1)
  if (questions.length === 0) return []
  const perTask = Math.max(sourceFloor, Math.floor(input.remainingSources / questions.length))
  return questions.map((question, index) => {
    const targetedFeedback = verificationRepairFeedbackForQuestion(input.run, input.verdict, question)
    return {
      id: `verification_repair_${input.attempt}_${input.roundIndex}_${index + 1}`,
      questionIds: [question.id],
      objective: `补充能改变最终判断的真实证据：${question.text}`,
      expectedEvidence: [
        '这个搜索任务如果成功，必须能改变、削弱或限定最终判断；如果只能补充相关背景，就不要把它当作完成证据。',
        ...targetedFeedback.slice(0, 3)
      ],
      sourceTypes: input.sourceTypes,
      searchHints: [
        input.run.brief.topic,
        input.run.frame.centralQuestion,
        question.text,
        ...targetedFeedback.slice(0, 4)
      ].map((hint) => hint.trim()).filter(Boolean),
      maxSources: Math.max(sourceFloor, Math.min(perTask, input.remainingSources - index * perTask || sourceFloor)),
      priority: question.priority,
      valueOfInformation: {
        uncertaintyImportance: 1,
        discriminativePower: 1,
        decisionImpact: 1,
        sourceFeasibility: input.sourceTypes.includes('web') ? 0.9 : 0.7,
        estimatedCost: 0.4,
        score: 0.95,
        decisionRelevanceQuestion: '如果补到这条证据，最终判断是否会改变、削弱或被限定？'
      },
      status: 'pending' as const
    }
  })
}

function verificationRepairFeedbackForQuestion(
  run: ResearchRun,
  verdict: QualityVerdict,
  question: ResearchRun['frame']['coreQuestions'][number]
): string[] {
  const sectionTitles = (run.reportContract?.requiredSections ?? [])
    .filter((section) => section.questionIds.includes(question.id))
    .map((section) => section.title)
  const feedback = [
    ...(verdict.issues ?? [])
      .filter((issue) => issue.severity === 'blocking')
      .map((issue) => issue.message),
    ...verdict.blockingIssues
  ].map((message) => message.trim()).filter(Boolean)
  const uniqueFeedback = [...new Set(feedback)]
  const targeted = uniqueFeedback.filter((message) =>
    message.includes(question.text)
    || sectionTitles.some((title) => repairFeedbackTargetsSection(message, title))
  )
  if (targeted.length > 0) {
    return [...new Set(targeted.map(positiveEvidenceRequirement).filter(Boolean))]
  }
  const evidenceFeedback = [...new Set((verdict.issues ?? [])
    .filter((issue) => /evidence/iu.test(issue.code))
    .filter((issue) => !/score_below_threshold/iu.test(issue.code))
    .map((issue) => issue.message.trim())
    .filter(Boolean))]
  return evidenceFeedback.length > 0 ? evidenceFeedback : uniqueFeedback
}

function positiveEvidenceRequirement(message: string): string {
  const targets: string[] = []
  for (const match of message.matchAll(/(?:未|没有|缺乏|缺少|不足)(?:能够|能)?(?:分析|解释|量化|提供|涉及|覆盖|比较|评估|纳入|讨论|包含|使用)?\s*([^\u3002；;]{2,180})/gu)) {
    const target = (match[1] ?? '')
      .replace(/^(?:任何|足以|关于|对于)\s*/u, '')
      .replace(/[，,]\s*(?:(?:且|并且|但|同时)\s*)?(?:也)?(?:未|没有|缺乏|缺少|不足)[\s\S]*$/u, '')
      .replace(/[，,：:\s]+$/u, '')
      .trim()
    if (target.length >= 2) targets.push(target)
  }
  for (const match of message.matchAll(/\b(?:missing|lacks?|does not (?:analyze|cover|provide|compare|quantify|explain))\s+([^.;]{2,180})/giu)) {
    const target = (match[1] ?? '').replace(/[,\s]+$/u, '').trim()
    if (target.length >= 2) targets.push(target)
  }
  const uniqueTargets = [...new Set(targets)].slice(0, 3)
  return uniqueTargets.length > 0
    ? `需要补充可核验的直接证据，覆盖：${uniqueTargets.join('；')}`
    : message
}

export function verificationRepairTargetQuestions(
  run: ResearchRun,
  verdict: QualityVerdict
): ResearchRun['frame']['coreQuestions'] {
  const issueText = [
    ...verdict.blockingIssues,
    ...(verdict.issues ?? []).filter((issue) => issue.severity === 'blocking').map((issue) => issue.message)
  ].join('\n')
  const targetedQuestionIds = new Set<string>()
  for (const question of run.frame.coreQuestions) {
    if (issueText.includes(question.text)) targetedQuestionIds.add(question.id)
  }
  for (const section of run.reportContract?.requiredSections ?? []) {
    if (!repairFeedbackTargetsSection(issueText, section.title)) continue
    section.questionIds.forEach((questionId) => targetedQuestionIds.add(questionId))
  }
  const uncoveredQuestionIds = new Set(run.gapVerdicts?.at(-1)?.coverageByQuestion
    .filter((coverage) => !coverage.covered)
    .map((coverage) => coverage.questionId) ?? [])
  const required = run.frame.coreQuestions.filter((question) => question.required || question.priority === 'high')
  const targeted = required.filter((question) => targetedQuestionIds.has(question.id))
  if (targeted.length > 0) return targeted
  const globalEvidenceDensityGap = (verdict.issues ?? []).some((issue) =>
    /(?:low_evidence_density|insufficient_evidence_use|evidence_gap)$/iu.test(issue.code)
  )
  if (globalEvidenceDensityGap) {
    const reportQuestionIds = new Set((run.reportContract?.requiredSections ?? [])
      .filter((section) => section.required)
      .flatMap((section) => section.questionIds))
    const reportQuestions = required.filter((question) => reportQuestionIds.has(question.id))
    if (reportQuestions.length > 0) return reportQuestions
  }
  const uncovered = required.filter((question) => uncoveredQuestionIds.has(question.id))
  return uncovered.length > 0 ? uncovered : required
}

function repairFeedbackTargetsSection(message: string, sectionTitle: string): boolean {
  const normalizedMessage = normalizeRepairSectionText(message)
  return repairSectionTitleVariants(sectionTitle).some((variant) => (
    variant.length >= 4 && normalizedMessage.includes(variant)
  ))
}

function repairSectionTitleVariants(sectionTitle: string): string[] {
  const withoutQuantity = sectionTitle
    .replace(/(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]{1,5})\s*(?:年|个月|月|周|天|日|季度)/gu, '')
    .replace(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[- ]?(?:years?|months?|weeks?|days?|quarters?)\b/giu, '')
  const withoutLeadingScope = withoutQuantity
    .replace(/^(?:过去|未来|最近|近期|当前|主要|关键|核心|总体|综合)+/u, '')
    .replace(/^(?:(?:past|future|recent|current|main|key|primary|overall)\s+)+/iu, '')
  return [...new Set([
    sectionTitle,
    withoutQuantity,
    withoutLeadingScope
  ].map(normalizeRepairSectionText).filter(Boolean))]
}

function normalizeRepairSectionText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function taskSourceFloorForRun(run: ResearchRun, remainingSources: number): number {
  if (remainingSources < 2) return 1
  return isComparisonResearchRun(run) ? 2 : 1
}

export function isComparisonResearchRun(run: ResearchRun): boolean {
  if ((run.frame.alternativesToCompare?.length ?? 0) >= 2) return true
  const text = [
    run.brief.topic,
    run.brief.userIntent,
    ...(run.brief.userClarifications ?? []),
    run.frame.centralQuestion,
    run.frame.coreResearchThread
  ].join('\n')
  return /对比|比较|区别|差异|哪个|哪家|\bvs\.?\b|versus|竞品|cursor|windsurf/i.test(text)
}

export function evidenceVerdictBeforeSynthesis(
  run: ResearchRun,
  _latestGap: ResearchGapVerdict | undefined,
  sources: SourceRecord[],
  evidenceSpans: EvidenceSpan[],
  webSearchEnabled: boolean,
  nowIso: string
): QualityVerdict | undefined {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const hasRealVerifiableEvidence = evidenceSpans.some((span) =>
    canCiteEvidenceSpan(span, sourceById.get(span.sourceId))
  )
  const isPreliminaryQuick = run.budget.preset === 'quick' && !webSearchEnabled

  if (!hasRealVerifiableEvidence && !isPreliminaryQuick) {
    const primaryIssue = webSearchEnabled
      ? 'evidence_blocking: Web 搜索已启用，但网页抽取没有形成可引用证据；系统已停止写作，避免把抽取失败误报成“Web 搜索已禁用”。'
      : 'evidence_blocking: Web 搜索未启用，且没有本地文件证据，系统无法生成带引用的 DeepResearch 报告。'
    const issues = [
      { code: 'research_evidence_insufficient', message: primaryIssue, severity: 'blocking' as const }
    ]
    return {
      pass: false,
      scores: {
        requirementsAlignment: 0,
        answersCoreQuestions: 0,
        followsCoreResearchThread: 0,
        reportCompleteness: 0,
        citationAccuracy: 0,
        evidenceCoverage: 0,
        sourceQuality: 0,
        conflictHandling: 0,
        uncertaintyCalibration: 0,
        writingQuality: 0,
        llmJudgeOverall: 0
      },
      blockingIssues: [primaryIssue],
      warnings: ['由于未收集到真实外部或本地证据，已前置拦截，未调用 Synthesis Writer 或 LLM Judge。'],
      recommendedFixes: webSearchEnabled
        ? [
            run.brief.sourcePolicy.allowedDomains?.length
              ? `检查指定来源 ${run.brief.sourcePolicy.allowedDomains.join('、')} 是否可访问，并调整检索词后重试。`
              : '检查搜索服务、目标网页抓取和证据抽取失败原因后重试。',
            '也可以在 Workspace 中提供包含相关事实的本地文件。'
          ]
        : [
            '开启联网功能重新运行，以获取真实的 Web 网页来源证据。',
            '在 Workspace 中提供包含相关研究事实的本地文件。'
          ],
      issues,
      verifiedAt: nowIso
    }
  }
  if (isPreliminaryQuick) return undefined
  return undefined
}

export function judgeFailureType(
  verdict: QualityVerdict
): 'writing_fixable' | 'citation_fixable' | 'evidence_blocking' | 'missing_required_dimensions' | 'scope_frame_mapping_error' | 'judge_unavailable' {
  if (verdict.llmJudge?.failureKind === 'judge_unavailable') return 'judge_unavailable'
  const issueCodes = (verdict.issues ?? [])
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => issue.code.toLowerCase())
  if (issueCodes.some((code) => code.includes('scope_frame_mapping'))) {
    return 'scope_frame_mapping_error'
  }
  if (issueCodes.some((code) => /(?:independent_source_missing|missing_evidence|evidence_missing|evidence_mismatch|unsupported_evidence|source_missing)$/u.test(code))) {
    return 'evidence_blocking'
  }
  if (issueCodes.some((code) => ['broken_citation', 'unresolved_citation', 'empty_citation_span', 'missing_evidence_span'].includes(code))) {
    return 'citation_fixable'
  }
  if (issueCodes.some((code) => code === 'missing_required_dimensions')) return 'missing_required_dimensions'
  if (issueCodes.some((code) => [
    'required_question_uncovered',
    'critical_unsupported_claim',
    'model_fallback_citation',
    'research_evidence_insufficient',
    'research_evidence_gap',
    'research_budget_exhausted',
    'required_section_evidence_missing',
    'central_question_evidence_missing',
    'synthetic_evidence_not_citable'
  ].includes(code))) return 'evidence_blocking'

  const blockingIssues = (verdict.issues ?? []).filter((issue) => issue.severity === 'blocking')
  const categorizedEvidenceGap = (verdict.llmJudge?.issues ?? []).find((issue) =>
    issue.severity === 'blocking'
    && !/score_below_threshold/iu.test(issue.code)
    && isConcreteJudgeEvidenceGap(issue.message)
  )
  if (categorizedEvidenceGap) {
    return categorizedEvidenceGap.category === 'evidence'
      ? 'evidence_blocking'
      : 'missing_required_dimensions'
  }
  if (issueCodes.some((code) => /(?:writing_repetition|writing_fragment|sentence_fragment|truncated_sentence|unpunctuated_prose|dangling_sentence|evidence_synthesis_missing|incomplete_synthesis|unsupported_(?:technical|tech)_expansion|writing_quality_below_threshold|low_writing_quality)/u.test(code))) {
    return 'writing_fixable'
  }
  if (blockingIssues.some((issue) => /(?:缺乏|没有|未提供|仅).{0,32}(?:局部结论|综合推理|边界分析|分析性综合)|(?:堆砌|罗列|重复).{0,12}事实/iu.test(issue.message))) {
    return 'writing_fixable'
  }
  const mergedCoverageGap = blockingIssues.some((issue) =>
    issue.code.toLowerCase().startsWith('llm_judge_coverage_')
    && isConcreteJudgeEvidenceGap(issue.message)
  )
  if (mergedCoverageGap) return 'missing_required_dimensions'
  const evidenceScoreBelowThreshold = blockingIssues.some((issue) =>
    issue.code.toLowerCase().endsWith('evidence_score_below_threshold')
  )
  const evidenceDensityGap = (verdict.issues ?? []).some((issue) =>
    /(?:low_evidence_density|insufficient_evidence_use|evidence_gap)$/iu.test(issue.code)
  )
  if (evidenceScoreBelowThreshold && evidenceDensityGap) return 'evidence_blocking'
  const concreteMissingDimension = blockingIssues.some((issue) =>
    /(?:incomplete_(?:chapter|section|analysis)|missing_dimension|lack_of_synthesis)/iu.test(issue.code)
    && isConcreteJudgeEvidenceGap(issue.message)
  )
  if (evidenceScoreBelowThreshold && concreteMissingDimension) return 'missing_required_dimensions'

  if (issueCodes.some((code) => /(?:citation_missing|citation_unfaithful|citation_mismatch)$/u.test(code))) {
    return 'citation_fixable'
  }

  return 'writing_fixable'
}

function isConcreteJudgeEvidenceGap(message: string): boolean {
  return /(?:未|没有)(?:分析|解释|量化|提供|涉及|覆盖|比较|评估|纳入|讨论).{2,100}(?:数据|指标|事实|机制|过程|条件|对象|维度|风险)|(?:缺乏|缺少).{0,100}(?:证据|时效性|数据|指标|事实|机制|过程|条件|对象|量化分析|深入分析)|仅(?:有|包含)?(?:一|1)(?:句事实|个引用|条证据)|证据(?:使用)?不足/u.test(message)
}

export function isFatalResearchTaskError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /research_(?:timeout|model_call_budget_exhausted|token_budget_exhausted)|research run cancelled by user/i.test(message)
}
