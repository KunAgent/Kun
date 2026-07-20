/**
 * [INPUT]: 依赖 core/types 的来源类型、置信度和运行契约
 * [OUTPUT]: 对外提供 SourceRecord、EvidenceSpan、AtomicClaim、带问题证据角色及已校验对比对象归属的 ResearchNote、CitationBinding 与 ledger 类型
 * [POS]: research/evidence 的数据契约中心，被 worker、store、writer、citation 和 verifier 共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchConfidence, ResearchEvidenceAssignment, ResearchSourceType } from '../core/types.js'

export type SourceReliability = 'high' | 'medium' | 'low' | 'unknown'
export type SourceStatus = 'fetched' | 'failed' | 'blocked' | 'stale'

export type SourceKind = 'web_strong' | 'web_weak' | 'user_file' | 'model_fallback'

export type SourceRecord = {
  id: string
  sourceType: ResearchSourceType
  title: string
  canonicalUrl?: string
  originalUrl?: string
  path?: string
  documentId?: string
  authors?: string[]
  publisher?: string
  publishedAt?: string
  accessedAt: string
  importedAt: string
  language?: string
  reliability: SourceReliability
  reliabilityReason?: string
  sourcePolicyTags: string[]
  fingerprint: string
  status: SourceStatus
  kind?: SourceKind
}

export type EvidenceSpan = {
  id: string
  sourceId: string
  text: string
  textHash: string
  location: {
    url?: string
    page?: number
    headingPath?: string[]
    paragraphIndex?: number
    charStart?: number
    charEnd?: number
    lineStart?: number
    lineEnd?: number
  }
  extractedAt: string
  extractorRunId: string
}

export type AtomicClaim = {
  id: string
  text: string
  normalizedText?: string
  entities: string[]
  claimType: 'fact' | 'metric' | 'date' | 'quote' | 'opinion' | 'inference' | 'recommendation'
  timeScope?: string
  polarity?: 'positive' | 'negative' | 'neutral'
  supportSpanIds: string[]
  confidence: ResearchConfidence
  critical?: boolean
}

export type ResearchNote = {
  id: string
  taskId: string
  questionIds: string[]
  claimIds: string[]
  summary: string
  implicationForBrief: string
  confidence: ResearchConfidence
  limitations: string[]
  conflictsWithNoteIds?: string[]
  evidenceAssignments?: ResearchEvidenceAssignment[]
  comparisonTargets?: string[]
}

export type CitationBinding = {
  id: string
  displayId?: string
  displayIds?: string[]
  reportPath: string
  reportAnchor: string
  reportClaimText: string
  claimId?: string
  claimIds?: string[]
  evidenceSpanIds: string[]
  status: 'verified' | 'weak' | 'unsupported' | 'contradicted'
  verifiedAt?: string
}

export type EvidenceLedgerEntry =
  | { kind: 'source'; record: SourceRecord }
  | { kind: 'evidence_span'; record: EvidenceSpan }
  | { kind: 'research_note'; record: ResearchNote }
