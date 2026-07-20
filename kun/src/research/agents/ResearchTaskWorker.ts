/**
 * [INPUT]: 依赖 WorkerResult、EvidenceEligibility 的通用抽取损坏判断与 ClaimSupport 的数字、胜负、部署和绝对化结论忠实检查
 * [OUTPUT]: 对外提供 dropInvalidWorkerClaims 与 validateWorkerResult，先局部剔除抽取损坏或不忠实 claim 并重建其 note/span/source，再校验 worker 不输出报告正文、引用完整且 claim 语义不越过证据原文，并允许显式 unresolved 的空证据结果进入 Gap 修复
 * [POS]: research/agents 的 Worker 输出边界，在证据入库前隔离不忠实 claim 并阻止越权字段、悬空引用；无证据不是异常，单条模型抽取瑕疵不能杀掉整次研究
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { assessClaimFaithfulness, unsupportedNumericTokens } from '../evidence/ClaimSupport.js'
import { isExtractionCorruptionText } from '../evidence/EvidenceEligibility.js'
import type { WorkerResult } from './types.js'

const FORBIDDEN_WORKER_REPORT_KEYS = new Set([
  'markdown',
  'report',
  'reportMarkdown',
  'draftReport',
  'section',
  'sections',
  'chapters'
])

export function dropInvalidWorkerClaims(result: WorkerResult): WorkerResult {
  const spanById = new Map(result.evidenceSpans.map((span) => [span.id, span]))
  const invalidClaimIds = new Set<string>()
  for (const claim of result.claims) {
    const supportingSpans = claim.supportSpanIds
      .map((spanId) => spanById.get(spanId))
      .filter((span): span is WorkerResult['evidenceSpans'][number] => Boolean(span))
    if (supportingSpans.length !== claim.supportSpanIds.length) continue
    const supportTexts = supportingSpans.map((span) => span.text)
    if (isExtractionCorruptionText(claim.text) ||
      supportingSpans.some((span) => isExtractionCorruptionText(span.text)) ||
      unsupportedNumericTokens(claim.text, supportTexts).length > 0 ||
      !assessClaimFaithfulness(claim.text, supportTexts).faithful) {
      invalidClaimIds.add(claim.id)
    }
  }
  if (invalidClaimIds.size === 0) return result

  const notes = result.notes
    .map((note) => ({
      ...note,
      claimIds: note.claimIds.filter((claimId) => !invalidClaimIds.has(claimId))
    }))
    .filter((note) => note.claimIds.length > 0)
  if (notes.length === 0) {
    return {
      ...result,
      sources: [],
      evidenceSpans: [],
      claims: [],
      notes: [],
      conflicts: [],
      unresolvedQuestions: [
        ...result.unresolvedQuestions,
        `Worker ${result.taskId} 的候选论断均未通过证据忠实校验，需要定向补研。`
      ]
    }
  }

  const retainedClaimIds = new Set(notes.flatMap((note) => note.claimIds))
  const claims = result.claims.filter((claim) => retainedClaimIds.has(claim.id))
  const retainedSpanIds = new Set(claims.flatMap((claim) => claim.supportSpanIds))
  const evidenceSpans = result.evidenceSpans.filter((span) => retainedSpanIds.has(span.id))
  const retainedSourceIds = new Set(evidenceSpans.map((span) => span.sourceId))
  return {
    ...result,
    sources: result.sources.filter((source) => retainedSourceIds.has(source.id)),
    evidenceSpans,
    claims,
    notes,
    conflicts: result.conflicts
      .map((conflict) => ({
        ...conflict,
        claimIds: conflict.claimIds.filter((claimId) => retainedClaimIds.has(claimId))
      }))
      .filter((conflict) => conflict.claimIds.length >= 2),
    unresolvedQuestions: [
      ...result.unresolvedQuestions,
      `已隔离 ${invalidClaimIds.size} 条未通过证据忠实校验的候选论断。`
    ]
  }
}

export function validateWorkerResult(result: WorkerResult): void {
  for (const key of Object.keys(result as Record<string, unknown>)) {
    if (FORBIDDEN_WORKER_REPORT_KEYS.has(key)) {
      throw new Error(`ResearchTaskWorker output must not include final report prose field: ${key}`)
    }
  }
  if (result.notes.length === 0) {
    const unresolvedOnly = result.sources.length === 0
      && result.evidenceSpans.length === 0
      && result.claims.length === 0
      && result.unresolvedQuestions.length > 0
    if (unresolvedOnly) return
    throw new Error(`ResearchTaskWorker ${result.taskId} must produce at least one structured note`)
  }
  for (const note of result.notes) {
    if (note.taskId !== result.taskId) {
      throw new Error(`ResearchNote ${note.id} taskId does not match worker task ${result.taskId}`)
    }
    for (const claimId of note.claimIds) {
      if (!result.claims.some((claim) => claim.id === claimId)) {
        throw new Error(`ResearchNote ${note.id} references unknown claim ${claimId}`)
      }
    }
  }
  for (const claim of result.claims) {
    const supportingSpans = claim.supportSpanIds
      .map((spanId) => result.evidenceSpans.find((span) => span.id === spanId))
      .filter((span): span is WorkerResult['evidenceSpans'][number] => Boolean(span))
    for (const spanId of claim.supportSpanIds) {
      if (!result.evidenceSpans.some((span) => span.id === spanId)) {
        throw new Error(`AtomicClaim ${claim.id} references unknown evidence span ${spanId}`)
      }
    }
    const unsupportedNumbers = unsupportedNumericTokens(claim.text, supportingSpans.map((span) => span.text))
    if (unsupportedNumbers.length > 0) {
      throw new Error(`AtomicClaim ${claim.id} contains numeric facts not present in its evidence spans: ${unsupportedNumbers.join(', ')}`)
    }
    const faithfulness = assessClaimFaithfulness(claim.text, supportingSpans.map((span) => span.text))
    if (!faithfulness.faithful) {
      throw new Error(`AtomicClaim ${claim.id} is not faithful to its evidence spans: ${faithfulness.reasons.join(', ')}`)
    }
  }
  for (const span of result.evidenceSpans) {
    if (!result.sources.some((source) => source.id === span.sourceId)) {
      throw new Error(`EvidenceSpan ${span.id} references unknown source ${span.sourceId}`)
    }
  }
}
