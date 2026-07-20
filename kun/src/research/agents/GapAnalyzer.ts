/**
 * [INPUT]: 依赖 CoverageEvaluatorInput 中的 plan、budget、evidence ledger 和 ResearchFrame
 * [OUTPUT]: 对外提供 BasicCoverageEvaluator，按覆盖矩阵判断问题、对比对象、强网页和反证缺口并生成 follow-up research tasks
 * [POS]: research/agents 的 gap loop 节点，位于 research worker 与 synthesis writer 之间，负责回收未用来源预算
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CoverageEvaluator, CoverageEvaluatorInput } from './types.js'
import type { ResearchConfidence, ResearchCoverageMatrix, ResearchGapStatus, ResearchGapVerdict, ResearchQuestion, ResearchQuestionCoverage, ResearchTask } from '../core/types.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'

export class BasicCoverageEvaluator implements CoverageEvaluator {
  async evaluate(input: CoverageEvaluatorInput): Promise<ResearchGapVerdict> {
    const coverageByQuestion = buildCoverage(input)
    const requiredGaps = coverageByQuestion.filter((coverage) =>
      (coverage.required || coverage.priority === 'high') && !coverage.covered
    )
    const coverageMatrix = buildCoverageMatrix(input, coverageByQuestion)
    const missingEvidence = [
      ...requiredGaps.flatMap((coverage) => coverage.missingEvidence),
      ...coverageMatrix.comparisonTargets
        .filter((target) => !target.covered)
        .map((target) => `对比对象「${target.target}」缺少独立来源覆盖。`),
      ...(!coverageMatrix.disconfirmingEvidenceCovered && requiresDisconfirmingEvidence(input)
        ? ['缺少反证、争议、限制条件或边界证据。']
        : [])
    ]
    const remainingSourceBudget = Math.max(0, input.budget.maxSources - input.sources.length)
    const canContinue = input.roundIndex < input.budget.maxResearchRounds && remainingSourceBudget > 0
    const followUpTasks = canContinue
      ? buildFollowUpTasks(input, coverageByQuestion, missingEvidence, remainingSourceBudget)
      : []
    const status = decideStatus({
      missingEvidence,
      followUpTasks,
      canContinue
    })

    return {
      id: `gap_${input.runId}_${input.roundIndex}`,
      roundIndex: input.roundIndex,
      status,
      confidence: confidenceForStatus(status, missingEvidence.length),
      stopReason: stopReasonForStatus(status, input, missingEvidence, remainingSourceBudget),
      coverageByQuestion,
      coverageMatrix,
      missingEvidence,
      followUpTasks,
      createdAt: input.nowIso
    }
  }
}

function requiredStrongWebSourceCount(input: CoverageEvaluatorInput): number {
  if (input.budget.preset === 'quick') return 0
  if (!input.brief.sourcePolicy.allowedSourceTypes.includes('web')) return 0
  return input.budget.preset === 'deep' ? 2 : 1
}

function isModelFallback(source: SourceRecord): boolean {
  return source.kind === 'model_fallback' || source.sourcePolicyTags.includes('model_generated')
}

function isStrongWebSource(source: SourceRecord): boolean {
  return source.kind === 'web_strong' || (
    source.sourceType === 'web' &&
    source.sourcePolicyTags.includes('web_fetch') &&
    source.sourcePolicyTags.includes('strong_web_evidence') &&
    !isModelFallback(source)
  )
}

function buildCoverage(input: CoverageEvaluatorInput): ResearchQuestionCoverage[] {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const notesByQuestion = new Map<string, typeof input.notes>()
  for (const note of input.notes) {
    for (const questionId of note.questionIds) {
      const bucket = notesByQuestion.get(questionId) ?? []
      bucket.push(note)
      notesByQuestion.set(questionId, bucket)
    }
  }

  return input.frame.coreQuestions.map((question) => {
    const notes = notesByQuestion.get(question.id) ?? []
    const claimIds = new Set(notes.flatMap((note) => note.claimIds))
    const claims = [...claimIds].map((claimId) => claimById.get(claimId)).filter((claim) => Boolean(claim))
    const sourceIds = new Set<string>()
    const strongWebSourceIds = new Set<string>()
    for (const claim of claims) {
      for (const spanId of claim?.supportSpanIds ?? []) {
        const sourceId = spanById.get(spanId)?.sourceId
        if (!sourceId) continue
        const source = sourceById.get(sourceId)
        if (!source || isModelFallback(source)) continue
        sourceIds.add(sourceId)
        if (isStrongWebSource(source)) strongWebSourceIds.add(sourceId)
      }
    }
    const requiredSourceCount = requiredSourcesForQuestion(input, question)
    const requiredStrongWebSources = question.required || question.priority === 'high'
      ? Math.min(requiredSourceCount, requiredStrongWebSourceCount(input))
      : 0
    const missingEvidence = missingEvidenceForQuestion(question, {
      noteCount: notes.length,
      claimCount: claims.length,
      criticalClaimCount: claims.filter((claim) => claim?.critical).length,
      sourceCount: sourceIds.size,
      strongWebSourceCount: strongWebSourceIds.size,
      requiredSourceCount,
      requiredStrongWebSourceCount: requiredStrongWebSources
    })
    return {
      questionId: question.id,
      question: question.text,
      required: question.required,
      priority: question.priority,
      covered: missingEvidence.length === 0,
      requiredSourceCount,
      requiredStrongWebSourceCount: requiredStrongWebSources,
      sourceCount: sourceIds.size,
      strongWebSourceCount: strongWebSourceIds.size,
      claimCount: claims.length,
      criticalClaimCount: claims.filter((claim) => claim?.critical).length,
      noteCount: notes.length,
      missingEvidence
    }
  })
}

function requiredSourcesForQuestion(input: CoverageEvaluatorInput, question: ResearchQuestion): number {
  const perQuestionBudget = Math.max(1, Math.floor(input.budget.maxSources / Math.max(1, input.frame.coreQuestions.length)))
  const presetTarget = input.budget.preset === 'deep' ? 3 : input.budget.preset === 'standard' ? 2 : 1
  const priorityTarget = question.required || question.priority === 'high' ? presetTarget : 1
  return Math.max(1, Math.min(perQuestionBudget, priorityTarget))
}

function missingEvidenceForQuestion(
  question: ResearchQuestion,
  stats: {
    noteCount: number
    claimCount: number
    criticalClaimCount: number
    sourceCount: number
    strongWebSourceCount: number
    requiredSourceCount: number
    requiredStrongWebSourceCount: number
  }
): string[] {
  const missing: string[] = []
  if (stats.noteCount === 0) missing.push(`问题「${question.text}」还没有结构化研究笔记。`)
  if (stats.claimCount === 0) missing.push(`问题「${question.text}」还没有可引用论断。`)
  if ((question.required || question.priority === 'high') && stats.criticalClaimCount === 0) {
    missing.push(`问题「${question.text}」缺少关键论断。`)
  }
  if (stats.sourceCount < stats.requiredSourceCount) {
    missing.push(`问题「${question.text}」来源数 ${stats.sourceCount} 低于要求 ${stats.requiredSourceCount}。`)
  }
  if (stats.requiredStrongWebSourceCount > 0 && stats.strongWebSourceCount < stats.requiredStrongWebSourceCount) {
    missing.push(`问题「${question.text}」真实网页来源数 ${stats.strongWebSourceCount} 低于要求 ${stats.requiredStrongWebSourceCount}。`)
  }
  return missing
}

function buildCoverageMatrix(
  input: CoverageEvaluatorInput,
  coverageByQuestion: ResearchQuestionCoverage[]
): ResearchCoverageMatrix {
  const required = coverageByQuestion.filter((coverage) => coverage.required || coverage.priority === 'high')
  const comparisonTargets = comparisonTargetsForInput(input)
    .map((target) => {
      const sourceCount = sourceCountForTarget(input, target)
      return {
        target,
        sourceCount,
        covered: sourceCount > 0
      }
    })
  return {
    totalSourceCount: input.sources.length,
    strongWebSourceCount: input.sources.filter(isStrongWebSource).length,
    requiredQuestionCount: required.length,
    coveredRequiredQuestionCount: required.filter((coverage) => coverage.covered).length,
    disconfirmingEvidenceCovered: hasDisconfirmingEvidence(input),
    comparisonTargets
  }
}

function comparisonTargetsForInput(input: CoverageEvaluatorInput): string[] {
  const explicit = (input.frame.alternativesToCompare ?? [])
    .map(cleanComparisonTarget)
    .filter((target) => target.length > 0)
  if (explicit.length >= 2) return [...new Set(explicit)].slice(0, 5)
  const text = [
    input.brief.topic,
    input.frame.centralQuestion,
    input.frame.coreResearchThread
  ].join('\n')
  if (!/对比|比较|区别|差异|哪个|哪家|\bvs\.?\b|versus/i.test(text)) return []
  const candidates = text
    .split(/\n/)
    .flatMap((line) => splitComparisonLine(line))
    .map(cleanComparisonTarget)
    .filter((target) => target.length > 0 && target.length <= 10 && !/体系|系统|生态|逻辑|表象|运营|收入|奖金|分配|结构|模式|游戏|赛事|比赛|定位|晋级|相同|不同|异同|[、()（）]/.test(target))
  return [...new Set(candidates)].slice(0, 5)
}

function splitComparisonLine(line: string): string[] {
  const beforeSignal = line
    .replace(/(?:的)?(?:区别|差异|对比|比较|异同|相同点|不同点|哪个更好|哪家更好|能否作为.*比较).*$/u, '')
    .replace(/\b(?:comparison|compare|difference|better).*$/iu, '')
  const parts = beforeSignal.split(/\s*(?:和|与|及|\/|\bvs\.?\b|\bversus\b)\s*/iu)
  return parts.length >= 2 ? parts : []
}

function cleanComparisonTarget(value: string): string {
  let cleaned = value
    .replace(/[「」"'“”]/g, '')
    .replace(/[：:]/g, ' ')
    .replace(/(?:电竞赛事|赛事生态|公司|品牌|产品|股票|市场|体系|系统|方案|路径|研究|调研|分析|完整报告|中文报告|比赛|对决|对战|项目|游戏)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (let index = 0; index < 3; index += 1) {
    cleaned = cleaned
      .replace(/^(?:我理解你要|用户希望|用户想要|用户想|请|帮我|帮忙|要|想|希望|重点|围绕|比较|对比|了解|研究|调研|分析)\s*/u, '')
      .replace(/^(?:围绕|比较|对比|了解|研究|调研|分析)\s*/u, '')
      .trim()
  }
  return cleaned
    .replace(/的(?:定价|价格|用户.*|产品.*|选型.*|核心.*|市场.*|财务.*|技术.*|商业.*|功能.*|体验.*|风险.*|差异.*|区别.*|对比.*|比较.*).*$/u, '')
    .replace(/(?:电竞赛事|赛事生态|公司|品牌|产品|股票|市场|体系|系统|方案|路径|研究|调研|分析|完整报告|中文报告|比赛|对决|对战|项目|游戏)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourceCountForTarget(input: CoverageEvaluatorInput, target: string): number {
  const corpusBySource = sourceCorpus(input)
  const aliases = targetAliases(target)
  let count = 0
  for (const corpus of corpusBySource.values()) {
    if (aliases.some((alias) => corpus.toLowerCase().includes(alias.toLowerCase()))) count += 1
  }
  return count
}

function sourceCorpus(input: CoverageEvaluatorInput): Map<string, string> {
  const corpus = new Map(input.sources
    .filter((source) => !isModelFallback(source))
    .map((source) => [
      source.id,
      [source.title, source.publisher, source.canonicalUrl, source.originalUrl, source.path, ...(source.sourcePolicyTags ?? [])].filter(Boolean).join('\n')
    ])
  )
  const sourceIdsByClaim = sourceIdsByClaimId(input.claims, input.evidenceSpans)
  for (const span of input.evidenceSpans) {
    if (corpus.has(span.sourceId)) {
      corpus.set(span.sourceId, `${corpus.get(span.sourceId) ?? ''}\n${span.text}`)
    }
  }
  for (const claim of input.claims) {
    for (const sourceId of sourceIdsByClaim.get(claim.id) ?? []) {
      if (corpus.has(sourceId)) {
        corpus.set(sourceId, `${corpus.get(sourceId) ?? ''}\n${claim.text}\n${claim.entities.join(' ')}`)
      }
    }
  }
  for (const note of input.notes) {
    for (const claimId of note.claimIds) {
      for (const sourceId of sourceIdsByClaim.get(claimId) ?? []) {
        if (corpus.has(sourceId)) {
          corpus.set(sourceId, `${corpus.get(sourceId) ?? ''}\n${note.summary}\n${note.implicationForBrief}`)
        }
      }
    }
  }
  return corpus
}

function sourceIdsByClaimId(claims: AtomicClaim[], spans: EvidenceSpan[]): Map<string, Set<string>> {
  const sourceIdBySpan = new Map(spans.map((span) => [span.id, span.sourceId]))
  const result = new Map<string, Set<string>>()
  for (const claim of claims) {
    const sourceIds = new Set<string>()
    for (const spanId of claim.supportSpanIds) {
      const sourceId = sourceIdBySpan.get(spanId)
      if (sourceId) sourceIds.add(sourceId)
    }
    result.set(claim.id, sourceIds)
  }
  return result
}

function targetAliases(target: string): string[] {
  const normalized = target.trim()
  const lower = normalized.toLowerCase().replace(/\s+/g, '')
  if (lower === 'cs' || lower === 'cs2' || lower === 'csgo') return [normalized, 'Counter-Strike', 'CS2', 'CS:GO', 'CSGO', '反恐精英']
  if (lower === 'dota2' || lower === 'dota') return [normalized, 'Dota 2', 'Dota2']
  return [normalized]
}

function requiresDisconfirmingEvidence(input: CoverageEvaluatorInput): boolean {
  return input.budget.preset !== 'quick' && input.frame.disconfirmingEvidenceNeeded.length > 0
}

function hasDisconfirmingEvidence(input: CoverageEvaluatorInput): boolean {
  if (!requiresDisconfirmingEvidence(input)) return true
  const validSourceIds = new Set(input.sources.filter((src) => !isModelFallback(src)).map((src) => src.id))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  return input.notes.some((note) => {
    const hasValidSource = note.claimIds.some((claimId) => {
      const claim = claimById.get(claimId)
      return claim?.supportSpanIds.some((spanId) => {
        const sourceId = spanById.get(spanId)?.sourceId
        return sourceId && validSourceIds.has(sourceId)
      })
    })
    if (!hasValidSource) return false
    return note.limitations.some((limitation) => limitation.trim().length > 0) ||
      /反证|争议|局限|限制|边界|风险|不确定|替代解释/.test(`${note.summary}\n${note.implicationForBrief}`)
  })
}

function buildFollowUpTasks(
  input: CoverageEvaluatorInput,
  coverageByQuestion: ResearchQuestionCoverage[],
  missingEvidence: string[],
  remainingSourceBudget: number
): ResearchTask[] {
  if (missingEvidence.length === 0) return []
  const uncovered = coverageByQuestion.filter((coverage) =>
    !coverage.covered && (coverage.required || coverage.priority === 'high')
  )
  const sourceDeficit = Math.max(0, input.budget.targetSources - input.sources.length)
  const deficitTarget = uncovered.length > 0
    ? uncovered
    : sourceDeficitTargets(coverageByQuestion, sourceDeficit)
  const taskCount = Math.max(1, Math.min(
    deficitTarget.length || 1,
    input.budget.maxSubagents,
    remainingSourceBudget,
    Math.max(1, Math.ceil(sourceDeficit / 4))
  ))
  const sourcesPerTask = distributeRemainingSources(remainingSourceBudget, taskCount)
  return deficitTarget.slice(0, taskCount).map((coverage, index) => ({
    id: `gap_${input.roundIndex + 1}_task_${index + 1}`,
    questionIds: [coverage.questionId],
    objective: `补足缺口：${coverage.question}`,
    expectedEvidence: [
      ...(coverage.missingEvidence.length > 0
        ? coverage.missingEvidence
        : [`为问题「${coverage.question}」补充更多独立来源，达到 ${input.budget.preset} preset 的最低来源覆盖。`]),
      ...input.frame.evidenceNeeded,
      ...(input.frame.disconfirmingEvidenceNeeded.length > 0 ? input.frame.disconfirmingEvidenceNeeded : ['反证、争议和边界条件。'])
    ].filter(Boolean),
    sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
    searchHints: [
      input.brief.topic,
      input.frame.coreResearchThread,
      coverage.question,
      ...coverage.missingEvidence,
      ...(input.brief.userClarifications ?? [])
    ].map((hint) => hint.trim()).filter(Boolean),
    maxSources: sourcesPerTask[index] ?? 1,
    priority: coverage.priority,
    status: 'pending'
  }))
}

function sourceDeficitTargets(
  coverageByQuestion: ResearchQuestionCoverage[],
  sourceDeficit: number
): ResearchQuestionCoverage[] {
  const candidates = coverageByQuestion
    .filter((coverage) => coverage.priority !== 'low')
    .sort((left, right) => {
      const priorityDelta = priorityRank(right) - priorityRank(left)
      if (priorityDelta !== 0) return priorityDelta
      return left.sourceCount - right.sourceCount
    })
  const wanted = Math.max(1, Math.ceil(sourceDeficit / 4))
  return candidates.slice(0, wanted)
}

function priorityRank(coverage: ResearchQuestionCoverage): number {
  if (coverage.required || coverage.priority === 'high') return 3
  if (coverage.priority === 'medium') return 2
  return 1
}

function distributeRemainingSources(totalSources: number, taskCount: number): number[] {
  const safeTaskCount = Math.max(1, taskCount)
  const perTask = Math.max(1, Math.floor(totalSources / safeTaskCount))
  const remainder = Math.max(0, totalSources - perTask * safeTaskCount)
  return Array.from({ length: safeTaskCount }, (_, index) => perTask + (index < remainder ? 1 : 0))
}

function decideStatus(input: {
  missingEvidence: string[]
  followUpTasks: ResearchTask[]
  canContinue: boolean
}): ResearchGapStatus {
  if (input.missingEvidence.length === 0) return 'sufficient'
  if (input.canContinue && input.followUpTasks.length > 0) return 'need_more'
  return 'budget_exhausted'
}

function confidenceForStatus(status: ResearchGapStatus, missingCount: number): ResearchConfidence {
  if (status === 'sufficient') return 'high'
  if (missingCount <= 2) return 'medium'
  return 'low'
}

function stopReasonForStatus(
  status: ResearchGapStatus,
  input: CoverageEvaluatorInput,
  missingEvidence: string[],
  remainingSourceBudget: number
): string {
  if (status === 'sufficient') {
    return `覆盖矩阵已满足：核心问题、对比对象、强网页证据和边界条件均达到当前 preset，可以进入报告合成。`
  }
  if (status === 'need_more') {
    return `发现 ${missingEvidence.length} 个证据缺口，剩余 ${remainingSourceBudget} 个来源预算，将进入下一轮补充研究。`
  }
  return `仍有 ${missingEvidence.length} 个证据缺口，但已达到轮次或来源预算边界；报告需要明确局限。`
}
