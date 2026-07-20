import type { ResearchConfidence, ResearchSourceType } from '../core/types.js'

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
}

export type CitationBinding = {
  id: string
  reportPath: string
  reportAnchor: string
  reportClaimText: string
  claimId?: string
  evidenceSpanIds: string[]
  status: 'verified' | 'weak' | 'unsupported' | 'contradicted'
  verifiedAt?: string
}

export type EvidenceLedgerEntry =
  | { kind: 'source'; record: SourceRecord }
  | { kind: 'evidence_span'; record: EvidenceSpan }
  | { kind: 'research_note'; record: ResearchNote }
