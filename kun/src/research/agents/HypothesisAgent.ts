/**
 * [INPUT]: 依赖 agents/types 的假设、测试、绑定、评估和收敛接口，依赖 core/types 的 ResearchTask/VOI 类型
 * [OUTPUT]: 对外提供 BasicHypothesisProposer、BasicTestDesigner、BasicEvidenceBinder、BasicHypothesisAssessor、把已完成定向任务的结构化证据视为测试已处理的 BasicConvergenceAnalyzer，以及受异常来源上限约束的 VOI 任务筛选函数
 * [POS]: research/agents 的判断收敛节点，把 DeepResearch 从 coverage 补资料升级为不受固定研究轮次截断的 hypothesis-driven / VOI-driven research loop，并避免因证据未绑定到备择假设而制造假未收敛
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  ConvergenceAnalyzer,
  ConvergenceAnalyzerInput,
  EvidenceBinder,
  EvidenceBinderInput,
  FrameRevisionGate,
  FrameRevisionGateInput,
  HypothesisAssessment,
  HypothesisAssessor,
  HypothesisAssessorInput,
  HypothesisProposer,
  HypothesisProposerInput,
  TestDesigner,
  TestDesignerInput
} from './types.js'
import type {
  FrameRevision,
  HypothesisEvidenceBinding,
  HypothesisTest,
  HypothesisUpdate,
  ResearchConvergenceVerdict,
  ResearchFrame,
  ResearchHypothesis,
  ResearchHypothesisStatus,
  ResearchPriority,
  ResearchTask,
  ResearchValueOfInformation
} from '../core/types.js'

const DECISION_RELEVANCE_QUESTION = '如果这个搜索任务成功，会不会改变最终判断？'

export class BasicHypothesisProposer implements HypothesisProposer {
  async propose(input: HypothesisProposerInput): Promise<ResearchHypothesis[]> {
    const hypotheses: ResearchHypothesis[] = []
    const explains = input.frame.coreQuestions.map((question) => question.id)
    hypotheses.push({
      id: 'h1_mainstream',
      statement: input.frame.coreResearchThread || input.frame.centralQuestion,
      explains,
      assumptions: [
        `用户问题「${input.brief.topic}」的关键前提成立。`,
        '现有公开证据足以区分主要解释。'
      ],
      predictions: [
        `如果该主线成立，应能观察到支撑「${input.frame.centralQuestion}」的事实、指标或案例。`,
        '关键来源之间不会出现无法解释的重大冲突。'
      ],
      falsifiers: [
        '关键事实与主线方向相反。',
        '替代解释能以更少假设解释同一现象。'
      ],
      discriminatingQuestions: [
        input.frame.centralQuestion,
        ...input.frame.coreQuestions.map((question) => question.text)
      ].slice(0, 4),
      supportingClaims: [],
      opposingClaims: [],
      uncertainty: input.frame.evidenceNeeded.slice(0, 4),
      status: 'candidate',
      confidence: 'medium'
    })

    const alternative = input.frame.disconfirmingEvidenceNeeded[0]
      || input.frame.alternativesToCompare?.join(' 与 ')
      || '存在替代解释、边界条件或用户问题前提不成立的可能。'
    hypotheses.push({
      id: 'h2_alternative',
      statement: `替代解释可能比主线更能改变结论：${alternative}`,
      explains,
      assumptions: ['核心主线不是唯一解释。', '关键反证或边界条件可以被找到。'],
      predictions: [
        '会出现与主线不一致但能解释现象的证据。',
        '至少一个替代变量会显著改变结论或行动建议。'
      ],
      falsifiers: [
        '替代解释缺少独立来源支持。',
        '反证只影响细节，不改变最终判断。'
      ],
      discriminatingQuestions: [
        `什么证据会削弱「${input.frame.coreResearchThread}」？`,
        `哪些替代解释会改变「${input.frame.centralQuestion}」的答案？`
      ],
      supportingClaims: [],
      opposingClaims: [],
      uncertainty: input.frame.disconfirmingEvidenceNeeded.slice(0, 4),
      status: 'candidate',
      confidence: 'low'
    })

    if ((input.frame.alternativesToCompare ?? []).length >= 2) {
      hypotheses.push({
        id: 'h3_comparison',
        statement: `最终判断取决于这些对象的关键差异：${input.frame.alternativesToCompare?.join('、')}`,
        explains,
        assumptions: ['比较对象可比。', '每个对象都有独立证据覆盖。'],
        predictions: ['决定性证据会落在差异指标、用户路径、成本收益或风险边界上。'],
        falsifiers: ['比较对象不可比，或某一对象缺少可靠证据。'],
        discriminatingQuestions: [
          `哪一个差异最可能改变「${input.frame.centralQuestion}」的结论？`
        ],
        supportingClaims: [],
        opposingClaims: [],
        uncertainty: ['比较口径、关键差异和对象覆盖是否可靠。'],
        status: 'candidate',
        confidence: 'medium'
      })
    }

    hypotheses.push({
      id: 'h_null',
      statement: 'null hypothesis：公开证据不足，或用户问题的关键前提不成立，因此不应给出强结论。',
      explains,
      assumptions: ['来源质量、口径或时间范围可能不足以支撑强判断。'],
      predictions: ['会出现证据缺口、口径冲突、来源不可比或只能得到弱结论的情况。'],
      falsifiers: ['多条独立高质量证据收敛到同一判断。'],
      discriminatingQuestions: [
        '继续搜索是否大概率改变最终判断？',
        '当前证据是否足以支撑用户用途？'
      ],
      supportingClaims: [],
      opposingClaims: [],
      uncertainty: ['证据充分性、来源质量和结论边界。'],
      status: 'candidate',
      confidence: 'medium'
    })

    return hypotheses.slice(0, 5)
  }
}

export class BasicTestDesigner implements TestDesigner {
  async design(input: TestDesignerInput): Promise<HypothesisTest[]> {
    const tests: HypothesisTest[] = []
    for (const hypothesis of input.hypotheses) {
      const questionIds = relatedQuestionIds(input.frame, hypothesis)
      const baseQuestion = hypothesis.discriminatingQuestions[0] || input.frame.centralQuestion
      tests.push({
        id: `test_${hypothesis.id}_1`,
        hypothesisId: hypothesis.id,
        questionIds,
        testQuestion: baseQuestion,
        expectedEvidenceIfTrue: hypothesis.predictions[0] || '如果假设成立，应能找到可追溯证据。',
        evidenceThatWouldWeakenIt: hypothesis.falsifiers[0] || '如果假设不成立，应能找到反证或边界条件。',
        preferredSources: input.brief.sourcePolicy.allowedSourceTypes,
        priority: hypothesis.id === 'h_null' ? 'medium' : 'high',
        valueOfInformation: valueOfInformationFor({
          priority: hypothesis.id === 'h_null' ? 'medium' : 'high',
          text: `${baseQuestion}\n${hypothesis.statement}`,
          maxSources: Math.max(1, Math.ceil(input.budget.targetSources / Math.max(1, input.hypotheses.length))),
          sourceTypes: input.brief.sourcePolicy.allowedSourceTypes
        })
      })
      if (hypothesis.falsifiers.length > 0) {
        tests.push({
          id: `test_${hypothesis.id}_falsifier`,
          hypothesisId: hypothesis.id,
          questionIds,
          testQuestion: `什么证据会削弱或推翻：${hypothesis.statement}`,
          expectedEvidenceIfTrue: hypothesis.predictions.join('；') || '支持该假设的证据。',
          evidenceThatWouldWeakenIt: hypothesis.falsifiers.join('；'),
          preferredSources: input.brief.sourcePolicy.allowedSourceTypes,
          priority: hypothesis.id === 'h_null' ? 'low' : 'medium',
          valueOfInformation: valueOfInformationFor({
            priority: hypothesis.id === 'h_null' ? 'low' : 'medium',
            text: `${hypothesis.falsifiers.join('\n')}\n${hypothesis.statement}`,
            maxSources: 2,
            sourceTypes: input.brief.sourcePolicy.allowedSourceTypes
          })
        })
      }
    }
    return tests
      .sort((left, right) => right.valueOfInformation.score - left.valueOfInformation.score)
      .slice(0, 12)
  }
}

export class BasicEvidenceBinder implements EvidenceBinder {
  async bind(input: EvidenceBinderInput): Promise<HypothesisEvidenceBinding[]> {
    const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
    const notesByClaimId = notesByClaim(input.notes)
    const bindings: HypothesisEvidenceBinding[] = []
    for (const claim of input.claims) {
      const claimText = [
        claim.text,
        claim.entities.join(' '),
        ...(notesByClaimId.get(claim.id) ?? []).map((note) => `${note.summary}\n${note.implicationForBrief}\n${note.limitations.join('\n')}`)
      ].join('\n')
      const scored = input.hypotheses
        .map((hypothesis) => ({
          hypothesis,
          score: textOverlap(claimText, hypothesisText(hypothesis))
        }))
        .sort((left, right) => right.score - left.score)
      const target = scored[0]?.hypothesis ?? input.hypotheses[0]
      if (!target) continue
      for (const spanId of claim.supportSpanIds) {
        if (!spanById.has(spanId)) continue
        const relation = relationForClaim(claimText, target)
        if (relation === 'irrelevant') continue
        bindings.push({
          id: `bind_${input.runId}_${target.id}_${spanId}`,
          hypothesisId: target.id,
          evidenceSpanId: spanId,
          claimId: claim.id,
          relation,
          strength: strengthForClaim(claimText, claim.critical === true),
          reason: reasonForBinding(relation, target.statement),
          createdAt: input.nowIso
        })
      }
    }
    return dedupeBindings(bindings)
  }
}

export class BasicHypothesisAssessor implements HypothesisAssessor {
  async assess(input: HypothesisAssessorInput): Promise<HypothesisAssessment> {
    const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
    const updates: HypothesisUpdate[] = []
    const hypotheses = input.hypotheses.map((hypothesis) => {
      const relatedBindings = input.bindings.filter((binding) => binding.hypothesisId === hypothesis.id)
      const supportingClaims = idsForRelation(relatedBindings, ['supports', 'qualifies'])
      const opposingClaims = idsForRelation(relatedBindings, ['weakens'])
      const supportWeight = weightBindings(relatedBindings.filter((binding) => binding.relation === 'supports' || binding.relation === 'qualifies'))
      const opposingWeight = weightBindings(relatedBindings.filter((binding) => binding.relation === 'weakens'))
      const previousStatus = hypothesis.status
      const newStatus = nextStatus(hypothesis.status, supportWeight, opposingWeight)
      const updated: ResearchHypothesis = {
        ...hypothesis,
        status: newStatus,
        confidence: confidenceForHypothesis(newStatus, supportWeight, opposingWeight),
        supportingClaims: [...new Set([...hypothesis.supportingClaims, ...supportingClaims])],
        opposingClaims: [...new Set([...hypothesis.opposingClaims, ...opposingClaims])],
        uncertainty: remainingUncertainty(hypothesis, supportWeight, opposingWeight)
      }
      updates.push({
        hypothesisId: hypothesis.id,
        previousStatus,
        newStatus,
        confidenceChange: confidenceChange(hypothesis.confidence, updated.confidence),
        updateReason: updateReason(updated, supportWeight, opposingWeight, claimById),
        keySupportingEvidenceIds: relatedBindings
          .filter((binding) => binding.relation === 'supports' || binding.relation === 'qualifies')
          .map((binding) => binding.evidenceSpanId)
          .slice(0, 4),
        keyOpposingEvidenceIds: relatedBindings
          .filter((binding) => binding.relation === 'weakens')
          .map((binding) => binding.evidenceSpanId)
          .slice(0, 4),
        remainingUncertainty: updated.uncertainty,
        createdAt: input.nowIso
      })
      return updated
    })
    return { hypotheses, updates }
  }
}

export class BasicFrameRevisionGate implements FrameRevisionGate {
  async revise(input: FrameRevisionGateInput): Promise<{ frame: ResearchFrame; revision?: FrameRevision }> {
    const leadingNull = input.hypotheses.find((hypothesis) => hypothesis.id === 'h_null' && hypothesis.status === 'leading')
    const weakenedMain = input.hypotheses.find((hypothesis) => hypothesis.id === 'h1_mainstream' && hypothesis.status === 'weakened')
    if (!leadingNull || !weakenedMain) return { frame: input.frame }
    const revisedCentralQuestion = `在公开证据约束下，${input.frame.centralQuestion}`
    if (revisedCentralQuestion === input.frame.centralQuestion) return { frame: input.frame }
    const revision: FrameRevision = {
      previousCentralQuestion: input.frame.centralQuestion,
      revisedCentralQuestion,
      reason: '主线假设被削弱，同时 null hypothesis 成为领先解释，需要把问题收敛到证据可判定范围。',
      evidenceIds: input.bindings
        .filter((binding) => binding.hypothesisId === 'h_null' || binding.hypothesisId === 'h1_mainstream')
        .map((binding) => binding.evidenceSpanId)
        .slice(0, 6),
      preservedUserConstraints: [
        input.brief.outputFormat,
        ...input.brief.constraints,
        ...(input.brief.userClarifications ?? [])
      ],
      changedInvestigationPath: [
        ...input.frame.investigationPath,
        '明确证据不足或原问题前提不成立时的结论边界'
      ],
      createdAt: input.nowIso
    }
    return {
      frame: {
        ...input.frame,
        centralQuestion: revisedCentralQuestion,
        investigationPath: revision.changedInvestigationPath
      },
      revision
    }
  }
}

export class BasicConvergenceAnalyzer implements ConvergenceAnalyzer {
  async analyze(input: ConvergenceAnalyzerInput): Promise<ResearchConvergenceVerdict> {
    const leading = leadingHypotheses(input.hypotheses)
    const unresolvedHighValueTests = input.tests
      .filter((test) => test.valueOfInformation.score >= 0.55 && !testHasBoundEvidence(test, input))
    const wouldFurtherResearchChangeConclusion = unresolvedHighValueTests.length > 0 &&
      input.sources.length < input.budget.maxSources
    const coverageReady = input.gapVerdict.status === 'sufficient'
    const readyToWrite = coverageReady && leading.length > 0 && !wouldFurtherResearchChangeConclusion
    const shouldFail = input.gapVerdict.status === 'budget_exhausted' && leading.length === 0
    return {
      id: `convergence_${input.runId}_${input.roundIndex}`,
      roundIndex: input.roundIndex,
      readyToWrite,
      shouldFail,
      reason: convergenceReason({ coverageReady, leadingCount: leading.length, unresolvedHighValueTests, wouldFurtherResearchChangeConclusion, shouldFail }),
      leadingHypothesisIds: leading.map((hypothesis) => hypothesis.id),
      unresolvedHighValueTestIds: unresolvedHighValueTests.map((test) => test.id),
      highValueOpenQuestions: unresolvedHighValueTests.map((test) => test.testQuestion),
      wouldFurtherResearchChangeConclusion,
      recommendedNextTaskIds: input.plan.tasks
        .filter((task) => (task.valueOfInformation?.score ?? 0) >= 0.55 && task.status !== 'done')
        .map((task) => task.id),
      createdAt: input.nowIso
    }
  }
}

function testHasBoundEvidence(
  test: HypothesisTest,
  input: ConvergenceAnalyzerInput
): boolean {
  const taskIds = new Set(input.plan.tasks
    .filter((task) => task.status === 'done' && task.testIds?.includes(test.id))
    .map((task) => task.id))
  if (taskIds.size === 0) return false
  const claimIds = new Set(input.notes
    .filter((note) => taskIds.has(note.taskId))
    .flatMap((note) => note.claimIds))
  const spanIds = new Set(input.claims
    .filter((claim) => claimIds.has(claim.id))
    .flatMap((claim) => claim.supportSpanIds))
  if (spanIds.size === 0) return false
  return input.bindings.some((binding) =>
    binding.hypothesisId === test.hypothesisId && spanIds.has(binding.evidenceSpanId)
  ) || claimIds.size > 0
}

export function selectTasksByValueOfInformation(
  tasks: ResearchTask[],
  tests: HypothesisTest[],
  input: { preset: string; maxSources: number }
): ResearchTask[] {
  if (tasks.length === 0) return []
  const scored = tasks.map((task) => annotateTaskWithValueOfInformation(task, tests))
  const threshold = input.preset === 'quick' ? 0.08 : input.preset === 'deep' ? 0.12 : 0.1
  const selected = scored.filter((task) =>
    (task.valueOfInformation?.score ?? 0) >= threshold ||
    task.priority === 'high'
  )
  const safeSelected = selected.length > 0 ? selected : [scored.sort((left, right) =>
    (right.valueOfInformation?.score ?? 0) - (left.valueOfInformation?.score ?? 0)
  )[0]!]
  return capTaskSources(safeSelected, input.maxSources)
}

function annotateTaskWithValueOfInformation(task: ResearchTask, tests: HypothesisTest[]): ResearchTask {
  const matched = tests
    .filter((test) =>
      textOverlap(task.objective, `${test.testQuestion}\n${test.expectedEvidenceIfTrue}\n${test.evidenceThatWouldWeakenIt}`) > 0 ||
      (test.questionIds.some((questionId) => task.questionIds.includes(questionId)) && hasDecisionChangingSignal(task))
    )
    .sort((left, right) => right.valueOfInformation.score - left.valueOfInformation.score)
  const bestTest = matched[0]
  const valueOfInformation = bestTest
    ? mergeTaskAndTestValue(task, bestTest)
    : valueOfInformationFor({
      priority: task.priority,
      text: `${task.objective}\n${task.expectedEvidence.join('\n')}`,
      maxSources: task.maxSources,
      sourceTypes: task.sourceTypes
    })
  return {
    ...task,
    hypothesisIds: bestTest ? [...new Set([...(task.hypothesisIds ?? []), bestTest.hypothesisId])] : task.hypothesisIds,
    testIds: matched.length > 0 ? [...new Set([...(task.testIds ?? []), ...matched.slice(0, 2).map((test) => test.id)])] : task.testIds,
    valueOfInformation,
    expectedEvidence: [
      `${DECISION_RELEVANCE_QUESTION} ${valueOfInformation.score >= 0.1 ? '会。该任务被保留，因为成功后可能改变或限定最终判断。' : '不明显。除非它服务于必答问题，否则不应继续搜索。'}`,
      ...task.expectedEvidence
    ],
    searchHints: [
      ...task.searchHints,
      ...(bestTest ? [bestTest.testQuestion, bestTest.evidenceThatWouldWeakenIt] : [])
    ].filter(Boolean)
  }
}

function hasDecisionChangingSignal(task: ResearchTask): boolean {
  const text = `${task.objective}\n${task.expectedEvidence.join('\n')}\n${task.searchHints.join('\n')}`
  return /反证|替代|区分|区别|差异|对比|比较|推翻|削弱|边界|争议|结论|判断|决策|风险|指标|归因|fals|weak|alternative|compare|versus|vs/i.test(text)
}

function mergeTaskAndTestValue(task: ResearchTask, test: HypothesisTest): ResearchValueOfInformation {
  const taskValue = valueOfInformationFor({
    priority: task.priority,
    text: `${task.objective}\n${task.expectedEvidence.join('\n')}`,
    maxSources: task.maxSources,
    sourceTypes: task.sourceTypes
  })
  const score = clamp((taskValue.score + test.valueOfInformation.score) / 2, 0, 1)
  return {
    uncertaintyImportance: clamp((taskValue.uncertaintyImportance + test.valueOfInformation.uncertaintyImportance) / 2, 0, 1),
    discriminativePower: clamp((taskValue.discriminativePower + test.valueOfInformation.discriminativePower) / 2, 0, 1),
    decisionImpact: clamp((taskValue.decisionImpact + test.valueOfInformation.decisionImpact) / 2, 0, 1),
    sourceFeasibility: clamp((taskValue.sourceFeasibility + test.valueOfInformation.sourceFeasibility) / 2, 0, 1),
    estimatedCost: clamp((taskValue.estimatedCost + test.valueOfInformation.estimatedCost) / 2, 0, 1),
    score,
    decisionRelevanceQuestion: DECISION_RELEVANCE_QUESTION
  }
}

function valueOfInformationFor(input: {
  priority: ResearchPriority
  text: string
  maxSources: number
  sourceTypes: readonly string[]
}): ResearchValueOfInformation {
  const text = input.text.toLowerCase()
  const uncertaintyImportance = input.priority === 'high' ? 0.95 : input.priority === 'medium' ? 0.72 : 0.45
  const discriminativePower = /反证|替代|区分|区别|差异|对比|比较|推翻|削弱|边界|争议|fals|weak|alternative|compare|versus|vs/i.test(text)
    ? 0.92
    : /原因|机制|路径|指标|数据|风险|结论|判断|决策/.test(text)
      ? 0.74
      : 0.55
  const decisionImpact = /结论|判断|决策|建议|风险|选择|选型|采用|购买|取舍|更好|是否|能否/.test(text)
    ? 0.9
    : 0.65
  const sourceFeasibility = input.sourceTypes.includes('web')
    ? 0.86
    : input.sourceTypes.includes('local_file') || input.sourceTypes.includes('pdf')
      ? 0.68
      : 0.55
  const estimatedCost = clamp(Math.max(1, input.maxSources) / 12, 0.08, 0.65)
  const score = clamp(
    uncertaintyImportance * discriminativePower * decisionImpact * sourceFeasibility - estimatedCost * 0.12,
    0,
    1
  )
  return {
    uncertaintyImportance,
    discriminativePower,
    decisionImpact,
    sourceFeasibility,
    estimatedCost,
    score,
    decisionRelevanceQuestion: DECISION_RELEVANCE_QUESTION
  }
}

function relatedQuestionIds(frame: ResearchFrame, hypothesis: ResearchHypothesis): string[] {
  const direct = hypothesis.explains.filter((id) => frame.coreQuestions.some((question) => question.id === id))
  if (direct.length > 0) return direct
  return frame.coreQuestions.filter((question) => question.required || question.priority === 'high').map((question) => question.id)
}

function notesByClaim(notes: EvidenceBinderInput['notes']): Map<string, EvidenceBinderInput['notes']> {
  const result = new Map<string, typeof notes>()
  for (const note of notes) {
    for (const claimId of note.claimIds) {
      const bucket = result.get(claimId) ?? []
      bucket.push(note)
      result.set(claimId, bucket)
    }
  }
  return result
}

function hypothesisText(hypothesis: ResearchHypothesis): string {
  return [
    hypothesis.statement,
    ...hypothesis.predictions,
    ...hypothesis.falsifiers,
    ...hypothesis.discriminatingQuestions,
    ...hypothesis.uncertainty
  ].join('\n')
}

function relationForClaim(text: string, hypothesis: ResearchHypothesis): HypothesisEvidenceBinding['relation'] {
  const normalized = text.toLowerCase()
  if (/反证|推翻|削弱|不成立|相反|冲突|下降|低于|风险|局限|限制|但|然而|不过|weaken|conflict|risk|decline/.test(normalized)) {
    return textOverlap(text, hypothesis.falsifiers.join('\n')) > 0 ? 'weakens' : 'qualifies'
  }
  if (textOverlap(text, hypothesisText(hypothesis)) > 0) return 'supports'
  return 'irrelevant'
}

function strengthForClaim(text: string, critical: boolean): HypothesisEvidenceBinding['strength'] {
  void text
  if (critical) return 'medium'
  return 'weak'
}

function reasonForBinding(relation: HypothesisEvidenceBinding['relation'], statement: string): string {
  if (relation === 'supports') return `该证据支持假设：${statement}`
  if (relation === 'weakens') return `该证据削弱假设：${statement}`
  if (relation === 'qualifies') return `该证据限定假设适用边界：${statement}`
  return `该证据与假设相关性不足：${statement}`
}

function idsForRelation(
  bindings: HypothesisEvidenceBinding[],
  relations: HypothesisEvidenceBinding['relation'][]
): string[] {
  return bindings
    .filter((binding) => relations.includes(binding.relation))
    .map((binding) => binding.claimId)
    .filter((claimId): claimId is string => Boolean(claimId))
}

function weightBindings(bindings: HypothesisEvidenceBinding[]): number {
  return bindings.reduce((sum, binding) => {
    if (binding.strength === 'strong') return sum + 2
    if (binding.strength === 'medium') return sum + 1
    return sum + 0.5
  }, 0)
}

function nextStatus(
  current: ResearchHypothesisStatus,
  supportWeight: number,
  opposingWeight: number
): ResearchHypothesisStatus {
  if (current === 'merged') return current
  if (opposingWeight >= 3 && supportWeight < 1) return 'rejected'
  if (opposingWeight > supportWeight) return 'weakened'
  if (supportWeight >= 2 && supportWeight >= opposingWeight) return 'leading'
  return 'candidate'
}

function confidenceForHypothesis(
  status: ResearchHypothesisStatus,
  supportWeight: number,
  opposingWeight: number
): 'low' | 'medium' | 'high' {
  if (status === 'leading' && supportWeight >= 3 && opposingWeight === 0) return 'high'
  if (status === 'rejected' || status === 'weakened') return opposingWeight >= 2 ? 'medium' : 'low'
  return supportWeight > 0 ? 'medium' : 'low'
}

function confidenceChange(previous: 'low' | 'medium' | 'high', next: 'low' | 'medium' | 'high'): HypothesisUpdate['confidenceChange'] {
  const rank = { low: 0, medium: 1, high: 2 }
  if (rank[next] > rank[previous]) return 'up'
  if (rank[next] < rank[previous]) return 'down'
  return 'same'
}

function remainingUncertainty(hypothesis: ResearchHypothesis, supportWeight: number, opposingWeight: number): string[] {
  if (supportWeight === 0 && opposingWeight === 0) return hypothesis.uncertainty
  if (opposingWeight > supportWeight) return [...new Set([...hypothesis.uncertainty, '需要确认反证是否足以改变最终判断。'])].slice(0, 5)
  return hypothesis.uncertainty.filter((item) => !/证据|来源|覆盖/.test(item)).slice(0, 4)
}

function updateReason(
  hypothesis: ResearchHypothesis,
  supportWeight: number,
  opposingWeight: number,
  claimById: Map<string, { text: string }>
): string {
  const supportPreview = hypothesis.supportingClaims
    .map((claimId) => claimById.get(claimId)?.text)
    .filter(Boolean)
    .slice(0, 2)
    .join('；')
  if (hypothesis.status === 'leading') return `支持证据权重 ${supportWeight.toFixed(1)} 高于反向证据 ${opposingWeight.toFixed(1)}。${supportPreview}`
  if (hypothesis.status === 'weakened' || hypothesis.status === 'rejected') return `反向或限定证据权重 ${opposingWeight.toFixed(1)} 高于支持证据 ${supportWeight.toFixed(1)}。`
  return `证据仍不足以让该假设成为领先解释。`
}

function leadingHypotheses(hypotheses: ResearchHypothesis[]): ResearchHypothesis[] {
  const leading = hypotheses.filter((hypothesis) => hypothesis.status === 'leading')
  if (leading.length > 0) return leading
  return hypotheses.filter((hypothesis) => hypothesis.supportingClaims.length > 0 && hypothesis.status === 'candidate')
}

function convergenceReason(input: {
  coverageReady: boolean
  leadingCount: number
  unresolvedHighValueTests: HypothesisTest[]
  wouldFurtherResearchChangeConclusion: boolean
  shouldFail: boolean
}): string {
  if (input.shouldFail) return '没有形成领先假设且证据预算已耗尽，继续写作会给出不可靠结论。'
  if (!input.coverageReady) return '报告完整性覆盖还未达标，需要先补足关键问题证据。'
  if (input.leadingCount === 0) return '尚未形成能够支撑最终判断的领先假设。'
  if (input.wouldFurtherResearchChangeConclusion) {
    return `仍有 ${input.unresolvedHighValueTests.length} 个高 VOI 测试未处理，继续搜索仍可能改变最终判断。`
  }
  return '最高价值不确定性已处理，主要候选解释已有证据绑定，继续搜索边际价值较低，可以进入写作。'
}

function dedupeBindings(bindings: HypothesisEvidenceBinding[]): HypothesisEvidenceBinding[] {
  const seen = new Set<string>()
  const result: HypothesisEvidenceBinding[] = []
  for (const binding of bindings) {
    const key = `${binding.hypothesisId}:${binding.evidenceSpanId}:${binding.claimId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(binding)
  }
  return result
}

function capTaskSources(tasks: ResearchTask[], maxSources: number): ResearchTask[] {
  let remaining = Math.max(0, maxSources)
  const capped: ResearchTask[] = []
  for (const task of tasks) {
    if (remaining <= 0) break
    const maxSourcesForTask = Math.min(task.maxSources, remaining)
    if (maxSourcesForTask <= 0) continue
    capped.push({ ...task, maxSources: maxSourcesForTask })
    remaining -= maxSourcesForTask
  }
  return capped
}

function textOverlap(left: string, right: string): number {
  const leftTokens = tokens(left)
  const rightTokens = new Set(tokens(right))
  if (leftTokens.length === 0 || rightTokens.size === 0) return 0
  const hits = leftTokens.filter((token) => rightTokens.has(token)).length
  return hits / Math.max(1, Math.min(leftTokens.length, rightTokens.size))
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 80)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
