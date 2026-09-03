import { createHash } from 'node:crypto'
import {
  DistillationDecision,
  MEMORY_CANDIDATE_MIN_CONFIDENCE,
  MemoryCandidate,
  MemoryCandidateAssessment,
  MemoryCandidateEvidenceContext,
  normalizeMemoryCandidateContent,
  type DistillationDecision as DistillationDecisionValue,
  type MemoryCandidateAssessmentInput,
  type MemoryCandidateEvidenceContextInput,
  type MemoryCandidateInput
} from '../contracts/memory-distillation.js'
import { MemoryRecord, type MemoryRecord as MemoryRecordValue } from '../contracts/memory.js'
import { memoryLifecycleState } from './memory-ranking.js'

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /\bAuthorization\s*[:=]\s*Basic\s+[A-Za-z0-9+/=]{12,}/iu,
  /\b(?:password|passwd|pwd|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|secret)\s*(?:is|[:=])\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`]{8,})/iu,
  /(?:密码|密钥|令牌)\s*(?:是|为|[:：=])\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`]{8,})/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/u,
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u
]

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /\bfor (?:this|the) (?:turn|request|session|response|reply)\b/iu,
  /\bfor now\b/iu,
  /\bthis time only\b/iu,
  /\bjust (?:for )?(?:now|once)\b/iu,
  /\b(?:one[ -]off|temporary) (?:request|task|instruction)\b/iu,
  /(?:这次|本次)(?:对话|回合|请求|任务|回复|回答)?(?:先|只|仅|临时)?/u,
  /当前(?:对话|回合|请求|任务|回复|回答)(?:先|只|仅|临时)?/u,
  /仅(?:限)?(?:本次|当前)(?:对话|回合|请求|任务|回复|回答)?/u
]

export class MemoryDistillationDecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryDistillationDecisionError'
  }
}

export function decideMemoryCandidate(
  input: MemoryCandidateAssessmentInput,
  authorizedRecords: readonly MemoryRecordValue[],
  evidenceInput: MemoryCandidateEvidenceContextInput,
  nowMs = Date.now()
): DistillationDecisionValue {
  const assessment = MemoryCandidateAssessment.parse(input)
  const evidence = MemoryCandidateEvidenceContext.parse(evidenceInput)
  validateDecisionTime(evidence.observedAt, nowMs)
  const activeRecords = validateAuthorizedRecords(authorizedRecords, assessment.comparisons, nowMs)
  const candidate = bindAuthorizedEvidence(assessment.candidate, evidence)

  if (containsCredentialLikeData(candidate)) {
    return DistillationDecision.parse({ action: 'skip', reason: 'sensitive' })
  }
  if (candidate.confidence < MEMORY_CANDIDATE_MIN_CONFIDENCE) {
    return DistillationDecision.parse({ action: 'skip', reason: 'low-confidence' })
  }
  if (assessment.durability === 'transient' || containsTransientRequest(candidate.content)) {
    return DistillationDecision.parse({ action: 'skip', reason: 'non-durable' })
  }

  const candidateContent = comparableContent(candidate.content)
  if ([...activeRecords.values()].some((record) => comparableContent(record.content) === candidateContent)) {
    return DistillationDecision.parse({ action: 'skip', reason: 'duplicate' })
  }

  const duplicate = assessment.comparisons.find((comparison) => comparison.relation === 'duplicate')
  if (duplicate) return DistillationDecision.parse({ action: 'skip', reason: 'duplicate' })

  const supersede = assessment.comparisons.find((comparison) => comparison.relation === 'supersede')
  if (supersede) {
    return DistillationDecision.parse({
      action: 'supersede',
      memoryId: supersede.memoryId,
      candidate
    })
  }

  const update = assessment.comparisons.find((comparison) => comparison.relation === 'update')
  if (update) {
    return DistillationDecision.parse({
      action: 'update',
      memoryId: update.memoryId,
      candidate
    })
  }

  return DistillationDecision.parse({ action: 'create', candidate })
}

export function memoryCandidateFingerprint(input: MemoryCandidateInput): string {
  const candidate = MemoryCandidate.parse(input)
  return createHash('sha256').update(JSON.stringify(candidate), 'utf8').digest('hex')
}

export function containsCredentialLikeData(input: MemoryCandidateInput): boolean {
  const candidate = MemoryCandidate.parse(input)
  const evidenceText = candidate.sources.flatMap((source) => [source.locator, source.excerpt])
  const text = [candidate.content, ...evidenceText].filter((value): value is string => Boolean(value)).join('\n')
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
}

export function containsTransientRequest(content: string): boolean {
  const normalized = normalizeMemoryCandidateContent(content)
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(normalized))
}

function validateAuthorizedRecords(
  records: readonly MemoryRecordValue[],
  comparisons: readonly { memoryId: string }[],
  nowMs: number
): Map<string, MemoryRecordValue> {
  const active = new Map<string, MemoryRecordValue>()
  for (const value of records) {
    const record = MemoryRecord.parse(value)
    if (active.has(record.id)) {
      throw new MemoryDistillationDecisionError(`duplicate authorized memory id: ${record.id}`)
    }
    if (memoryLifecycleState(record, nowMs) === 'active') active.set(record.id, record)
  }
  for (const comparison of comparisons) {
    if (!active.has(comparison.memoryId)) {
      throw new MemoryDistillationDecisionError(
        `comparison target is not an authorized active memory: ${comparison.memoryId}`
      )
    }
  }
  return active
}

function bindAuthorizedEvidence(
  draft: MemoryCandidateAssessment['candidate'],
  evidence: MemoryCandidateEvidenceContext
): MemoryCandidate {
  const authorizedSources = new Map(evidence.sources.map((source) => [source.id, source]))
  const sources = draft.sourceIds.map((sourceId) => {
    const source = authorizedSources.get(sourceId)
    if (!source) {
      throw new MemoryDistillationDecisionError(
        `candidate source is not authorized for this turn: ${sourceId}`
      )
    }
    return source
  })
  return MemoryCandidate.parse({
    content: draft.content,
    type: draft.type,
    confidence: draft.confidence,
    importance: draft.importance,
    tags: draft.tags,
    observedAt: evidence.observedAt,
    sources
  })
}

function validateDecisionTime(observedAt: string, nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new MemoryDistillationDecisionError('decision time must be finite')
  }
  if (Date.parse(observedAt) > nowMs) {
    throw new MemoryDistillationDecisionError('candidate observation time is in the future')
  }
}

function comparableContent(content: string): string {
  return normalizeMemoryCandidateContent(content).toLocaleLowerCase('en-US')
}
